import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { db } from "../src/db/kysely.js";
import { onTicketEvent } from "../src/modules/tickets/events.js";
import { buildTestApp, closeDb, loginAs, TEST_USERS, uniqueKey } from "./helpers.js";

type Headers = Record<string, string>;
type Actor = { id: string; headers: Headers };

let app: App;
let requester: Actor; // agente048
let agencyOwner: Actor; // agente049, dueño de la agencia de agente048
let other: Actor; // agente002
let admin: Actor; // agente015
let secondAdmin: Actor; // agente104
const created: string[] = [];

beforeAll(async () => {
  app = await buildTestApp();
  requester = await loginAs(TEST_USERS.requester);
  agencyOwner = await loginAs(TEST_USERS.agencyOwner);
  other = await loginAs(TEST_USERS.otherRequester);
  admin = await loginAs(TEST_USERS.admin);
  secondAdmin = await loginAs(TEST_USERS.secondAdmin);
});

afterAll(async () => {
  // Los tickets de prueba no deben aparecer en la bandeja de la demo.
  if (created.length) await db.deleteFrom("helpdesk.tickets").where("id", "in", created).execute();
  await app.close();
  await closeDb();
});

const tag = uniqueKey("run");

async function createTicket(actor: Actor, overrides: Record<string, unknown> = {}, key = uniqueKey()) {
  const res = await app.inject({
    method: "POST",
    url: "/tickets",
    headers: { ...actor.headers, "idempotency-key": key },
    payload: {
      title: `No puedo exportar el reporte ${tag}`,
      description: "Al pulsar Exportar aparece un error y no se descarga nada.",
      category: "screens",
      impact: "high",
      ...overrides,
    },
  });
  if (res.statusCode === 201) created.push(res.json().id);
  return res;
}

const get = (actor: Actor, url: string) => app.inject({ method: "GET", url, headers: actor.headers });
const patch = (actor: Actor, url: string, payload: unknown) =>
  app.inject({ method: "PATCH", url, headers: actor.headers, payload: payload as object });
const post = (actor: Actor, url: string, payload: unknown) =>
  app.inject({ method: "POST", url, headers: { ...actor.headers, "idempotency-key": uniqueKey() }, payload: payload as object });

describe("AC-002.1 / AC-002.2 / AC-002.3 create", () => {
  it("creates an open ticket with a visible number and the requester from the session", async () => {
    const res = await createTicket(requester, { impact: "critical" });
    expect(res.statusCode).toBe(201);
    const ticket = res.json();
    expect(ticket).toMatchObject({
      status: "open",
      requester: { id: requester.id },
      priority: "urgent",
      impact: "critical",
      source: "manual_form",
      ai_summary: null,
      original_description: "Al pulsar Exportar aparece un error y no se descarga nada.",
      version: 1,
      reopened_count: 0,
    });
    expect(ticket.display_number).toMatch(/^TCK-\d{6}$/);
    expect(ticket.events.map((e: { type: string }) => e.type)).toEqual(["created"]);
    expect(ticket.assignee).toBeUndefined();
  });

  it("does not duplicate on retry with the same Idempotency-Key", async () => {
    const key = uniqueKey();
    const first = await createTicket(requester, {}, key);
    const retry = await createTicket(requester, {}, key);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(retry.json().id).toBe(first.json().id);
  });

  it("rejects a requester sent by the client and unknown categories", async () => {
    expect((await createTicket(requester, { requester_id: other.id })).statusCode).toBe(400);
    expect((await createTicket(requester, { category: "no-existe" })).statusCode).toBe(400);
  });
});

describe("AC-002.4 / AC-002.7 isolation", () => {
  it("only the owner and admins can see a ticket; sharing an agency gives no access", async () => {
    const ticket = (await createTicket(requester)).json();
    for (const outsider of [agencyOwner, other]) {
      expect((await get(outsider, `/tickets/${ticket.id}`)).statusCode).toBe(404);
      const list = (await get(outsider, `/tickets?q=${tag}`)).json();
      expect(list.items.map((t: { id: string }) => t.id)).not.toContain(ticket.id);
    }
    expect((await get(requester, `/tickets/${ticket.id}`)).statusCode).toBe(200);
    const adminView = (await get(admin, `/tickets/${ticket.id}`)).json();
    expect(adminView.permissions.can_change_status).toBe(true);
    expect(adminView.assignee).toBeNull();
  });

  it("returns 404 (not 403) for management actions on someone else's ticket", async () => {
    const ticket = (await createTicket(requester)).json();
    expect((await patch(other, `/tickets/${ticket.id}/status`, { status: "in_review", version: 1 })).statusCode).toBe(404);
    expect((await post(other, `/tickets/${ticket.id}/comments`, { body: "hola" })).statusCode).toBe(404);
  });
});

describe("AC-002.5 list filters", () => {
  it("filters by view, number, accent-insensitive text, category and paginates", async () => {
    const a = (await createTicket(requester, { title: `Sesión cerrada inesperadamente ${tag}`, category: "access" })).json();
    const b = (await createTicket(requester, { category: "uploads" })).json();
    await patch(admin, `/tickets/${b.id}/status`, { status: "in_review", version: 1 });

    const byNumber = (await get(requester, `/tickets?q=${a.display_number}`)).json();
    expect(byNumber.items.map((t: { id: string }) => t.id)).toEqual([a.id]);
    const byText = (await get(requester, `/tickets?q=sesion%20cerrada%20inesperadamente%20${tag}`)).json();
    expect(byText.items.map((t: { id: string }) => t.id)).toEqual([a.id]);
    const byCategory = (await get(requester, `/tickets?q=${tag}&category=uploads`)).json();
    expect(byCategory.items.every((t: { category: string }) => t.category === "uploads")).toBe(true);
    const inReview = (await get(requester, `/tickets?q=${tag}&view=in_review`)).json();
    expect(inReview.items.map((t: { id: string }) => t.id)).toContain(b.id);
    expect(inReview.counts.in_review).toBeGreaterThanOrEqual(1);

    const page = (await get(requester, `/tickets?q=${tag}&page_size=1&sort=number&order=asc`)).json();
    expect(page.items).toHaveLength(1);
    expect(page.total).toBeGreaterThan(1);
    expect((await get(requester, "/tickets?view=nope")).statusCode).toBe(400);
  });
});

describe("AC-002.8 / AC-002.9 / AC-002.10 comments and internal notes", () => {
  it("hides internal notes and their events from the requester, also in unread", async () => {
    const ticket = (await createTicket(requester)).json();
    await get(requester, `/tickets/${ticket.id}`); // marca como leído

    const note = await post(admin, `/tickets/${ticket.id}/comments`, { body: "Posible error de permisos", visibility: "internal" });
    expect(note.statusCode).toBe(201);
    const afterNote = (await get(requester, `/tickets?q=${ticket.display_number}`)).json();
    expect(afterNote.items[0].unread).toBe(false);

    const detail = (await get(requester, `/tickets/${ticket.id}`)).json();
    expect(detail.comments).toHaveLength(0);
    expect(detail.events.every((e: { visibility: string }) => e.visibility === "public")).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("Posible error de permisos");

    const adminDetail = (await get(admin, `/tickets/${ticket.id}`)).json();
    expect(adminDetail.comments.map((c: { visibility: string }) => c.visibility)).toEqual(["internal"]);
    expect(adminDetail.first_response_at).toBeNull();

    await post(admin, `/tickets/${ticket.id}/comments`, { body: "¿Qué navegador usas?", requests_info: true });
    const afterReply = (await get(requester, `/tickets?q=${ticket.display_number}`)).json();
    expect(afterReply.items[0].unread).toBe(true);
    expect((await get(admin, `/tickets/${ticket.id}`)).json().first_response_at).not.toBeNull();
  });

  it("rejects an info request on the admin's own ticket", async () => {
    const own = (await createTicket(admin)).json();
    expect(own.permissions.can_request_info).toBe(false);
    expect((await post(admin, `/tickets/${own.id}/comments`, { body: "¿Qué navegador?", requests_info: true })).statusCode).toBe(400);
  });

  it("forbids internal notes and info requests from the requester", async () => {
    const ticket = (await createTicket(requester)).json();
    expect((await post(requester, `/tickets/${ticket.id}/comments`, { body: "x", visibility: "internal" })).statusCode).toBe(403);
    expect((await post(requester, `/tickets/${ticket.id}/comments`, { body: "x", requests_info: true })).statusCode).toBe(403);
    const ok = await post(requester, `/tickets/${ticket.id}/comments`, { body: "Uso Chrome" });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().author.is_team).toBe(false);
  });

  it("AC-002.11 keeps the previous text when a comment is corrected", async () => {
    const ticket = (await createTicket(requester)).json();
    const comment = (await post(requester, `/tickets/${ticket.id}/comments`, { body: "Uso Firefx" })).json();
    expect((await patch(admin, `/tickets/${ticket.id}/comments/${comment.id}`, { body: "otro" })).statusCode).toBe(403);
    const edited = await patch(requester, `/tickets/${ticket.id}/comments/${comment.id}`, { body: "Uso Firefox" });
    expect(edited.json()).toMatchObject({ body: "Uso Firefox", edited_at: expect.any(String) });
    const revisions = await db
      .selectFrom("helpdesk.ticket_comment_revisions")
      .select("previous_body")
      .where("comment_id", "=", comment.id)
      .execute();
    expect(revisions).toEqual([{ previous_body: "Uso Firefx" }]);
  });
});

describe("AC-002.12 / AC-002.13 status and reopen", () => {
  it("runs the full cycle and keeps the history", async () => {
    const ticket = (await createTicket(requester)).json();
    expect((await patch(requester, `/tickets/${ticket.id}/status`, { status: "in_review", version: 1 })).statusCode).toBe(403);

    const reviewing = await patch(admin, `/tickets/${ticket.id}/status`, { status: "in_review", version: 1 });
    expect(reviewing.json()).toMatchObject({ status: "in_review", version: 2 });

    // Mismo estado (doble clic con versión vieja): 200 sin evento nuevo.
    const again = await patch(admin, `/tickets/${ticket.id}/status`, { status: "in_review", version: 1 });
    expect(again.statusCode).toBe(200);
    expect(again.json().events.filter((e: { type: string }) => e.type === "status_changed")).toHaveLength(1);

    expect((await patch(admin, `/tickets/${ticket.id}/status`, { status: "open", version: 2 })).json().error).toBe(
      "invalid_transition",
    );
    const noSummary = await patch(admin, `/tickets/${ticket.id}/status`, { status: "closed", version: 2, closure_reason: "resolved" });
    expect(noSummary.statusCode).toBe(422);
    expect(noSummary.json().error).toBe("resolution_required");

    const closed = await patch(admin, `/tickets/${ticket.id}/status`, {
      status: "closed",
      version: 2,
      closure_reason: "resolved",
      resolution_summary: "Se corrigió el permiso de exportación.",
    });
    expect(closed.json()).toMatchObject({ status: "closed", closure_reason: "resolved", version: 3 });
    expect(closed.json().closed_at).not.toBeNull();

    const blocked = await post(requester, `/tickets/${ticket.id}/comments`, { body: "Volvió a fallar" });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("ticket_closed");
    expect((await post(other, `/tickets/${ticket.id}/reopen`, { version: 3, reason: "x".repeat(5) })).statusCode).toBe(404);

    const reopened = await post(requester, `/tickets/${ticket.id}/reopen`, { version: 3, reason: "Volvió a fallar hoy" });
    expect(reopened.json()).toMatchObject({ status: "open", reopened_count: 1, closure_reason: null, closed_at: null });
    const types = reopened.json().events.map((e: { type: string }) => e.type);
    expect(types).toEqual(["created", "status_changed", "status_changed", "reopened"]);
    expect((await post(requester, `/tickets/${ticket.id}/reopen`, { version: 4, reason: "otra vez" })).statusCode).toBe(422);
  });

  it("closes from open as a duplicate of another ticket", async () => {
    const original = (await createTicket(requester)).json();
    const dup = (await createTicket(requester)).json();
    const res = await patch(admin, `/tickets/${dup.id}/status`, {
      status: "closed",
      version: 1,
      closure_reason: "duplicate",
      duplicate_of_number: original.number,
    });
    expect(res.json()).toMatchObject({ status: "closed", duplicate_of: { id: original.id } });
  });
});

describe("AC-002.14 / AC-002.15 concurrency, assignment and attributes", () => {
  it("lets one admin win and returns 409 with the current ticket to the other", async () => {
    const ticket = (await createTicket(requester)).json();
    const [a, b] = await Promise.all([
      patch(admin, `/tickets/${ticket.id}/assignee`, { version: 1, assignee_id: admin.id }),
      patch(secondAdmin, `/tickets/${ticket.id}/assignee`, { version: 1, assignee_id: secondAdmin.id }),
    ]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);
    const conflict = [a, b].find((r) => r.statusCode === 409)!.json();
    expect(conflict.error).toBe("version_conflict");
    expect(conflict.details.current.version).toBe(2);
  });

  it("assigns only admins and records internal events hidden from the requester", async () => {
    const ticket = (await createTicket(requester)).json();
    expect((await patch(admin, `/tickets/${ticket.id}/assignee`, { version: 1, assignee_id: other.id })).statusCode).toBe(400);
    const assigned = await patch(admin, `/tickets/${ticket.id}/assignee`, { version: 1, assignee_id: secondAdmin.id });
    expect(assigned.json().assignee.id).toBe(secondAdmin.id);
    const updated = await patch(admin, `/tickets/${ticket.id}`, { version: 2, priority: "low", category: "access", tags: ["Export", "export"] });
    expect(updated.json()).toMatchObject({ priority: "low", category: "access", tags: ["export"], version: 3 });
    expect((await patch(requester, `/tickets/${ticket.id}`, { version: 3, priority: "urgent" })).statusCode).toBe(403);

    const mine = (await get(requester, `/tickets/${ticket.id}`)).json();
    expect(mine.events.map((e: { type: string }) => e.type)).toEqual(["created"]);
    expect(mine.tags).toBeUndefined();
    expect(mine.assignee).toBeUndefined();
  });
});

describe("AC-002.16 / AC-002.17 events are transactional", () => {
  it("rolls back the ticket when an event listener fails", async () => {
    const unsubscribe = onTicketEvent(async () => {
      throw new Error("listener failure");
    });
    try {
      const res = await createTicket(requester, { title: `Debe revertirse ${tag}` });
      expect(res.statusCode).toBe(500);
    } finally {
      unsubscribe();
    }
    const found = (await get(requester, `/tickets?q=${encodeURIComponent(`Debe revertirse ${tag}`)}`)).json();
    expect(found.total).toBe(0);
  });
});

describe("support catalogs", () => {
  it("lists categories and hides priority targets from requesters", async () => {
    expect((await get(requester, "/support/categories")).json()).toHaveLength(6);
    const priorities = (await get(requester, "/support/priorities")).json();
    expect(priorities[0]).not.toHaveProperty("first_response_target_minutes");
    expect((await get(admin, "/support/priorities")).json()[0]).toHaveProperty("first_response_target_minutes");
    expect((await get(requester, "/support/admins")).statusCode).toBe(403);
    expect((await get(admin, "/support/admins")).json().length).toBeGreaterThanOrEqual(2);
  });
});
