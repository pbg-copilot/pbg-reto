import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { db } from "../src/db/kysely.js";
import type { Job } from "../src/db/types.js";
import { onTicketEvent } from "../src/modules/tickets/events.js";
import { createNotificationListener, emailJobKey } from "../src/modules/notifications/listener.js";
import { createDeliverEmailHandler, type MailMessage } from "../src/modules/notifications/email.js";
import { buildTestApp, closeDb, loginAs, testEnv, TEST_USERS, uniqueKey } from "./helpers.js";

type Actor = { id: string; headers: Record<string, string> };

let app: App;
let requester: Actor; // agente048
let other: Actor; // agente002
let admin: Actor; // agente015
let secondAdmin: Actor; // agente104
const created: string[] = [];
const tag = uniqueKey("notif");

beforeAll(async () => {
  app = await buildTestApp();
  requester = await loginAs(TEST_USERS.requester);
  other = await loginAs(TEST_USERS.otherRequester);
  admin = await loginAs(TEST_USERS.admin);
  secondAdmin = await loginAs(TEST_USERS.secondAdmin);
});

afterAll(async () => {
  // Borrar los tickets borra en cascada sus notificaciones y entregas.
  if (created.length) await db.deleteFrom("helpdesk.tickets").where("id", "in", created).execute();
  await db.deleteFrom("helpdesk.notifications").where("dedupe_key", "like", `${tag}%`).execute();
  await app.close();
  await closeDb();
});

const get = (actor: Actor, url: string) => app.inject({ method: "GET", url, headers: actor.headers });
const patch = (actor: Actor, url: string, payload?: unknown) =>
  app.inject({ method: "PATCH", url, headers: actor.headers, payload: payload as object });
const post = (actor: Actor, url: string, payload?: unknown) =>
  app.inject({ method: "POST", url, headers: { ...actor.headers, "idempotency-key": uniqueKey() }, payload: payload as object });

async function createTicket(title = `No carga el tablero ${tag}`) {
  const res = await post(requester, "/tickets", {
    title,
    description: "Al entrar al tablero la pantalla queda en blanco.",
    category: "screens",
    impact: "medium",
  });
  expect(res.statusCode).toBe(201);
  created.push(res.json().id);
  return res.json() as { id: string; version: number; display_number: string };
}

const notificationsOf = (recipientId: string, ticketId: string) =>
  db
    .selectFrom("helpdesk.notifications")
    .selectAll()
    .where("recipient_id", "=", recipientId)
    .where("ticket_id", "=", ticketId)
    .orderBy("created_at")
    .execute();

const deliveriesOf = (notificationId: string) =>
  db.selectFrom("helpdesk.notification_deliveries").selectAll().where("notification_id", "=", notificationId).orderBy("channel").execute();

describe("AC-005.1 / AC-005.2 / AC-005.7 notifications are created with each event", () => {
  it("creation confirms to the requester (in_app + email) and tells the unassigned team (in_app)", async () => {
    const ticket = await createTicket();
    const [mine] = await notificationsOf(requester.id, ticket.id);
    expect(mine).toMatchObject({ type: "ticket_created", title: `Recibimos tu ticket ${ticket.display_number}`, read_at: null });
    const channels = await deliveriesOf(mine!.id);
    expect(channels.map((d) => [d.channel, d.status])).toEqual([
      ["email", expect.stringMatching(/^(pending|delivered)$/)],
      ["in_app", "delivered"],
    ]);
    const job = await db.selectFrom("helpdesk.jobs").select(["type"]).where("dedupe_key", "=", emailJobKey(channels[0]!.id)).executeTakeFirst();
    expect(job?.type).toBe("deliver_email");

    const [team] = await notificationsOf(admin.id, ticket.id);
    expect(team).toMatchObject({ type: "new_ticket" });
    expect((await deliveriesOf(team!.id)).map((d) => d.channel)).toEqual(["in_app"]);
  });

  it("a status change notifies the requester with number, from, to, date and link; not the admin who did it", async () => {
    const ticket = await createTicket();
    const res = await patch(admin, `/tickets/${ticket.id}/status`, { status: "in_review", version: ticket.version });
    expect(res.statusCode).toBe(200);
    const change = (await notificationsOf(requester.id, ticket.id)).find((n) => n.type === "status_changed");
    expect(change).toMatchObject({
      title: `${ticket.display_number} pasó de Abierto a En revisión`,
      link: `/tickets/${ticket.id}`,
      payload: { display_number: ticket.display_number, from: "Abierto", to: "En revisión", at: expect.any(String) },
    });
    const adminOwn = await notificationsOf(admin.id, ticket.id);
    expect(adminOwn.map((n) => n.type)).toEqual(["new_ticket"]);
  });

  it("T005.4 if anything fails after the event, there is no notification and the ticket is unchanged", async () => {
    const ticket = await createTicket();
    const before = await notificationsOf(requester.id, ticket.id);
    const unsubscribe = onTicketEvent(async () => {
      throw new Error("listener failure");
    });
    try {
      const res = await patch(admin, `/tickets/${ticket.id}/status`, { status: "in_review", version: ticket.version });
      expect(res.statusCode).toBe(500);
    } finally {
      unsubscribe();
    }
    expect(await notificationsOf(requester.id, ticket.id)).toHaveLength(before.length);
    expect((await get(requester, `/tickets/${ticket.id}`)).json().status).toBe("open");
  });
});

describe("AC-005.2 / AC-005.3 comments, assignment and reopen", () => {
  let ticket: { id: string; version: number; display_number: string };

  beforeAll(async () => {
    ticket = await createTicket();
  });

  it("internal notes never reach the requester; public team comments are cut at 140 characters", async () => {
    const before = (await notificationsOf(requester.id, ticket.id)).length;
    const secret = `Nota interna ${tag}: revisar la base de datos`;
    expect((await post(admin, `/tickets/${ticket.id}/comments`, { body: secret, visibility: "internal" })).statusCode).toBe(201);
    expect(await notificationsOf(requester.id, ticket.id)).toHaveLength(before);

    const long = `Estamos revisando tu caso. ${"Detalle ".repeat(40)}`;
    expect((await post(admin, `/tickets/${ticket.id}/comments`, { body: long, visibility: "public" })).statusCode).toBe(201);
    const mine = await notificationsOf(requester.id, ticket.id);
    const comment = mine.find((n) => n.type === "team_comment")!;
    expect(comment.body.length).toBeLessThanOrEqual(140);
    expect(JSON.stringify(mine)).not.toContain(secret);
  });

  it("an info request is its own type", async () => {
    const res = await post(admin, `/tickets/${ticket.id}/comments`, { body: "¿Qué navegador usas?", visibility: "public", requests_info: true });
    expect(res.statusCode).toBe(201);
    expect((await notificationsOf(requester.id, ticket.id)).some((n) => n.type === "info_requested")).toBe(true);
  });

  it("assignment notifies the new assignee; a requester reply then goes to the assignee only", async () => {
    const current = (await get(admin, `/tickets/${ticket.id}`)).json();
    expect((await patch(admin, `/tickets/${ticket.id}/assignee`, { assignee_id: secondAdmin.id, version: current.version })).statusCode).toBe(200);
    expect((await notificationsOf(secondAdmin.id, ticket.id)).map((n) => n.type)).toContain("ticket_assigned");

    const adminBefore = (await notificationsOf(admin.id, ticket.id)).length;
    expect((await post(requester, `/tickets/${ticket.id}/comments`, { body: "Uso Firefox.", visibility: "public" })).statusCode).toBe(201);
    expect((await notificationsOf(secondAdmin.id, ticket.id)).map((n) => n.type)).toContain("requester_replied");
    expect(await notificationsOf(admin.id, ticket.id)).toHaveLength(adminBefore);
  });

  it("a reopen by the requester tells the team, not the requester", async () => {
    let current = (await get(admin, `/tickets/${ticket.id}`)).json();
    const closed = await patch(admin, `/tickets/${ticket.id}/status`, {
      status: "closed",
      version: current.version,
      closure_reason: "resolved",
      resolution_summary: "Se limpió la caché del navegador.",
    });
    expect(closed.statusCode).toBe(200);
    const closing = (await notificationsOf(requester.id, ticket.id)).find((n) => n.type === "status_changed")!;
    expect(closing.body).toBe("Motivo: Resuelto. Se limpió la caché del navegador.");

    current = (await get(requester, `/tickets/${ticket.id}`)).json();
    const reopened = await post(requester, `/tickets/${ticket.id}/reopen`, { reason: "Volvió a pasar hoy.", version: current.version });
    expect(reopened.statusCode).toBe(200);
    expect((await notificationsOf(secondAdmin.id, ticket.id)).some((n) => n.type === "ticket_reopened")).toBe(true);
    expect((await notificationsOf(requester.id, ticket.id)).some((n) => n.type === "ticket_reopened")).toBe(false);
  });

  it("AC-005.9 reprocessing the same event does not duplicate notifications", async () => {
    const event = await db
      .selectFrom("helpdesk.ticket_events")
      .selectAll()
      .where("ticket_id", "=", ticket.id)
      .where("type", "=", "status_changed")
      .executeTakeFirstOrThrow();
    const row = await db.selectFrom("helpdesk.tickets").selectAll().where("id", "=", ticket.id).executeTakeFirstOrThrow();
    const count = async () =>
      Number(
        (await db.selectFrom("helpdesk.notifications").select((eb) => eb.fn.countAll<string>().as("n")).where("source_event_id", "=", event.id).executeTakeFirstOrThrow()).n,
      );
    const before = await count();
    const listener = createNotificationListener({ email: true });
    await db.transaction().execute((trx) => listener(trx, event, row));
    await db.transaction().execute((trx) => listener(trx, event, row));
    expect(await count()).toBe(before);
  });
});

describe("AC-005.4 / AC-005.5 inbox", () => {
  it("persists while offline, lists only own notifications, and marks them read", async () => {
    const ticket = await createTicket();
    await patch(admin, `/tickets/${ticket.id}/status`, { status: "in_review", version: ticket.version });

    // El solicitante "vuelve a entrar": las notificaciones siguen ahí, sin leer.
    const count = (await get(requester, "/notifications/unread-count")).json().count;
    expect(count).toBeGreaterThanOrEqual(2);

    const unread = (await get(requester, "/notifications?unread=true&page_size=50")).json();
    expect(unread.unread_count).toBe(count);
    const target = unread.items.find((n: { link: string; type: string }) => n.link === `/tickets/${ticket.id}` && n.type === "status_changed");
    expect(target).toBeDefined();
    const mineIds = new Set((await db.selectFrom("helpdesk.notifications").select("id").where("recipient_id", "=", requester.id).execute()).map((r) => r.id));
    expect(unread.items.every((n: { id: string }) => mineIds.has(n.id))).toBe(true);

    // Una ajena no se puede leer ni marcar.
    expect((await patch(other, `/notifications/${target.id}/read`)).statusCode).toBe(404);

    const first = await patch(requester, `/notifications/${target.id}/read`);
    expect(first.statusCode).toBe(200);
    const again = await patch(requester, `/notifications/${target.id}/read`);
    expect(again.json().read_at).toBe(first.json().read_at);
    expect((await get(requester, "/notifications/unread-count")).json().count).toBe(count - 1);

    const all = await app.inject({ method: "POST", url: "/notifications/read-all", headers: requester.headers });
    expect(all.json().updated).toBe(count - 1);
    expect((await get(requester, "/notifications/unread-count")).json().count).toBe(0);
  });

  it("requires a session", async () => {
    expect((await app.inject({ method: "GET", url: "/notifications" })).statusCode).toBe(401);
  });
});

describe("AC-005.10 deliveries per channel for admins", () => {
  it("admins see the delivery status per channel without email addresses; requesters get 403", async () => {
    const ticket = await createTicket();
    const res = await get(admin, `/tickets/${ticket.id}/deliveries`);
    expect(res.statusCode).toBe(200);
    const deliveries = res.json();
    expect(deliveries.some((d: { channel: string }) => d.channel === "email")).toBe(true);
    expect(deliveries.some((d: { channel: string; status: string }) => d.channel === "in_app" && d.status === "delivered")).toBe(true);
    expect(JSON.stringify(deliveries)).not.toContain("@");
    expect((await get(requester, `/tickets/${ticket.id}/deliveries`)).statusCode).toBe(403);
  });

  it("an admin can retry a failed email; anything else is a 409", async () => {
    const ticket = await createTicket();
    const email = (await get(admin, `/tickets/${ticket.id}/deliveries`)).json().find((d: { channel: string }) => d.channel === "email");
    await db.updateTable("helpdesk.notification_deliveries").set({ status: "failed", last_error: "test" }).where("id", "=", email.id).execute();
    await db.updateTable("helpdesk.jobs").set({ status: "failed" }).where("dedupe_key", "=", emailJobKey(email.id)).execute();

    expect((await post(requester, `/notifications/deliveries/${email.id}/retry`)).statusCode).toBe(403);
    expect((await post(admin, `/notifications/deliveries/${email.id}/retry`)).statusCode).toBe(204);
    const job = await db.selectFrom("helpdesk.jobs").selectAll().where("dedupe_key", "=", emailJobKey(email.id)).executeTakeFirstOrThrow();
    expect(job.status).toMatch(/^(queued|running|succeeded)$/);
    expect((await post(admin, `/notifications/deliveries/${email.id}/retry`)).statusCode).toBe(409);
  });
});

describe("AC-005.8 / AC-005.9 email delivery worker", () => {
  // Entrega creada a mano y sin job: el worker de compose no la toma.
  async function pendingEmail() {
    const notification = await db
      .insertInto("helpdesk.notifications")
      .values({
        recipient_id: requester.id,
        ticket_id: null,
        type: "status_changed",
        title: "TCK-000001 pasó de Abierto a En revisión",
        body: "Prueba",
        payload: {},
        link: "/tickets/00000000-0000-0000-0000-000000000000",
        source_event_id: null,
        dedupe_key: uniqueKey(tag),
        read_at: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const delivery = await db
      .insertInto("helpdesk.notification_deliveries")
      .values({ notification_id: notification.id, channel: "email", status: "pending", last_error: null, delivered_at: null })
      .returning("id")
      .executeTakeFirstOrThrow();
    return delivery.id;
  }

  const jobFor = (deliveryId: string) => ({ id: "job", payload: { delivery_id: deliveryId } }) as unknown as Job;
  const deliveryRow = (id: string) => db.selectFrom("helpdesk.notification_deliveries").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

  function flakyMailer(failures: number) {
    const sent: MailMessage[] = [];
    let calls = 0;
    return {
      sent,
      calls: () => calls,
      mailer: {
        async send(message: MailMessage) {
          calls += 1;
          if (calls <= failures) throw new Error("connect ECONNREFUSED mailpit:1025");
          sent.push(message);
        },
      },
    };
  }

  it("retries on failure and delivers on the third attempt with a deterministic Message-ID", async () => {
    const id = await pendingEmail();
    const smtp = flakyMailer(2);
    const handler = createDeliverEmailHandler({ db, env: testEnv(), mailer: smtp.mailer });
    await expect(handler.run(jobFor(id))).rejects.toThrow();
    await expect(handler.run(jobFor(id))).rejects.toThrow();
    expect(await deliveryRow(id)).toMatchObject({ status: "pending", attempts: 2, last_error: "connect ECONNREFUSED mailpit:1025" });

    await handler.run(jobFor(id));
    expect(await deliveryRow(id)).toMatchObject({ status: "delivered", attempts: 3, last_error: null });
    expect(smtp.sent[0]).toMatchObject({ messageId: `<${id}@reto.local>`, subject: "TCK-000001 pasó de Abierto a En revisión" });
    expect(smtp.sent[0]!.to.endsWith("@reto.example")).toBe(true);

    // Idempotente: una entrega ya entregada no se reenvía.
    await handler.run(jobFor(id));
    expect(smtp.calls()).toBe(3);
  });

  it("marks the delivery failed when retries are exhausted", async () => {
    const id = await pendingEmail();
    const handler = createDeliverEmailHandler({ db, env: testEnv(), mailer: flakyMailer(99).mailer });
    await expect(handler.run(jobFor(id))).rejects.toThrow();
    await handler.onFinalFailure!(jobFor(id), new Error("connect ECONNREFUSED"));
    expect(await deliveryRow(id)).toMatchObject({ status: "failed", last_error: "connect ECONNREFUSED" });
  });

  it("never sends to a domain outside MAIL_ALLOWED_DOMAINS", async () => {
    const id = await pendingEmail();
    const smtp = flakyMailer(0);
    const handler = createDeliverEmailHandler({ db, env: { ...testEnv(), MAIL_ALLOWED_DOMAINS: ["otro.example"] }, mailer: smtp.mailer });
    await handler.run(jobFor(id));
    expect(smtp.calls()).toBe(0);
    expect(await deliveryRow(id)).toMatchObject({ status: "failed", last_error: "recipient_domain_not_allowed" });
  });
});
