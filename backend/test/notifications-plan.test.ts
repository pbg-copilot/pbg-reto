import { describe, expect, it } from "vitest";
import { excerpt, needsTeam, planNotifications, type PlanEvent, type PlanTicket } from "../src/modules/notifications/plan.js";
import { renderEmail, safeError } from "../src/modules/notifications/email.js";

const ticket: PlanTicket = { id: "t-1", number: 42, title: "No puedo exportar", requester_id: "req", assignee_id: null };
const at = new Date("2026-10-21T15:00:00Z");
const event = (overrides: Partial<PlanEvent>): PlanEvent => ({
  id: 7,
  type: "status_changed",
  visibility: "public",
  actor_id: "admin-1",
  data: {},
  created_at: at,
  ...overrides,
});
const context = { team: ["admin-1", "admin-2"], requesterName: "Ana", commentBody: null };

describe("T005.2 renderNotification", () => {
  it("AC-005.1 a status change tells the requester the number, both states, date and link", () => {
    const [item, ...rest] = planNotifications(event({ data: { from: "open", to: "in_review" } }), ticket, context);
    expect(rest).toHaveLength(0);
    expect(item).toMatchObject({
      recipientId: "req",
      type: "status_changed",
      title: "TCK-000042 pasó de Abierto a En revisión",
      link: "/tickets/t-1",
      email: true,
      payload: { display_number: "TCK-000042", from: "Abierto", to: "En revisión", at: at.toISOString() },
    });
  });

  it("closing includes the public closure reason", () => {
    const [item] = planNotifications(
      event({ data: { from: "in_review", to: "closed", closure_reason: "resolved", resolution_summary: "Se corrigió el filtro." } }),
      ticket,
      context,
    );
    expect(item!.body).toBe("Motivo: Resuelto. Se corrigió el filtro.");
  });

  it("excerpt cuts at 140 characters", () => {
    const long = "a ".repeat(200);
    expect(excerpt(long)).toHaveLength(140);
    expect(excerpt(long).endsWith("…")).toBe(true);
    expect(excerpt("  corto\n texto ")).toBe("corto texto");
  });
});

describe("T005.3 resolveRecipients", () => {
  it("AC-005.2 creation confirms to the requester (even as actor) and tells the team", () => {
    const items = planNotifications(event({ type: "created", actor_id: "req" }), ticket, context);
    expect(items.map((i) => [i.recipientId, i.type, i.email])).toEqual([
      ["req", "ticket_created", true],
      ["admin-1", "new_ticket", false],
      ["admin-2", "new_ticket", false],
    ]);
  });

  it("AC-005.3 internal notes notify nobody", () => {
    const internal = event({ type: "comment_added", visibility: "internal", data: { from_team: true } });
    expect(planNotifications(internal, ticket, { ...context, commentBody: "secreto" })).toEqual([]);
    expect(needsTeam(internal)).toBe(false);
  });

  it("AC-005.2 a team comment or info request goes to the requester; a requester reply goes to the team", () => {
    const team = planNotifications(event({ type: "comment_added", data: { from_team: true, requests_info: true } }), ticket, {
      ...context,
      commentBody: "¿Nos envías una captura?",
    });
    expect(team).toMatchObject([{ recipientId: "req", type: "info_requested", body: "¿Nos envías una captura?" }]);

    const reply = planNotifications(event({ type: "comment_added", actor_id: "req", data: { from_team: false } }), ticket, {
      ...context,
      commentBody: "Adjunto la captura",
    });
    expect(reply.map((i) => [i.recipientId, i.type, i.title])).toEqual([
      ["admin-1", "requester_replied", "Ana respondió en TCK-000042"],
      ["admin-2", "requester_replied", "Ana respondió en TCK-000042"],
    ]);
  });

  it("the actor never notifies themselves", () => {
    const items = planNotifications(event({ type: "reopened", actor_id: "admin-1", data: { reason: "Volvió", by_team: true } }), ticket, context);
    expect(items.map((i) => [i.recipientId, i.title])).toEqual([
      ["req", "TCK-000042 se reabrió"],
      ["admin-2", "TCK-000042 se reabrió"],
    ]);
  });

  it("an admin who is also the requester gets a single notification per event", () => {
    const own = { ...ticket, requester_id: "admin-2" };
    const items = planNotifications(event({ type: "created", actor_id: "admin-2" }), own, context);
    expect(items.map((i) => [i.recipientId, i.type])).toEqual([
      ["admin-2", "ticket_created"],
      ["admin-1", "new_ticket"],
    ]);
  });

  it("assignment tells only the new assignee, unless they assigned themselves", () => {
    const assigned = event({ type: "assigned", visibility: "internal", data: { from: null, to: "admin-2" } });
    expect(planNotifications(assigned, ticket, context)).toMatchObject([
      { recipientId: "admin-2", type: "ticket_assigned", email: false },
    ]);
    expect(planNotifications({ ...assigned, actor_id: "admin-2" }, ticket, context)).toEqual([]);
  });
});

describe("email rendering", () => {
  it("escapes HTML and links to the app", () => {
    const { html, text } = renderEmail({ title: "TCK-1 <b>", body: "x & y", link: "/tickets/t-1" }, "http://localhost:8088");
    expect(html).toContain("TCK-1 &lt;b&gt;");
    expect(html).toContain("x &amp; y");
    expect(text).toContain("http://localhost:8088/tickets/t-1");
  });

  it("stored errors never contain email addresses", () => {
    expect(safeError(new Error("550 rejected <ana@reto.example>"))).toBe("550 rejected <[correo]>");
  });
});
