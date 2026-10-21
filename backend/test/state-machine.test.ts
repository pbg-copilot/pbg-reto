import { describe, expect, it } from "vitest";
import type { Agent } from "@reto/shared";
import { reopen, transition } from "../src/modules/tickets/state-machine.js";
import { permissionsFor } from "../src/modules/tickets/policy.js";

describe("AC-002.12 transitions", () => {
  it("allows open → in_review and treats the same status as a no-op", () => {
    expect(transition("open", "in_review")).toMatchObject({ kind: "ok", changes: { status: "in_review" } });
    expect(transition("in_review", "in_review")).toEqual({ kind: "noop" });
  });

  it("rejects transitions that are not in the state machine", () => {
    for (const [from, to] of [
      ["in_review", "open"],
      ["closed", "in_review"],
      ["closed", "open"],
    ] as const)
      expect(transition(from, to)).toMatchObject({ kind: "error", code: "invalid_transition" });
  });

  it("requires a closure reason and a summary (or the original ticket for duplicates)", () => {
    expect(transition("in_review", "closed")).toMatchObject({ code: "resolution_required" });
    expect(transition("in_review", "closed", { closure_reason: "resolved" })).toMatchObject({ code: "resolution_required" });
    expect(transition("open", "closed", { closure_reason: "invalid", resolution_summary: "  " })).toMatchObject({
      code: "resolution_required",
    });
    expect(transition("open", "closed", { closure_reason: "duplicate" })).toMatchObject({ code: "resolution_required" });
    expect(
      transition("in_review", "closed", { closure_reason: "resolved", resolution_summary: " Se limpió la caché. " }),
    ).toEqual({
      kind: "ok",
      changes: { status: "closed", closure_reason: "resolved", resolution_summary: "Se limpió la caché.", duplicate_of_ticket_id: null },
    });
    expect(transition("open", "closed", { closure_reason: "duplicate", duplicate_of_ticket_id: "t-1" })).toMatchObject({
      kind: "ok",
      changes: { closure_reason: "duplicate", duplicate_of_ticket_id: "t-1" },
    });
  });

  it("AC-002.13 only reopens closed tickets", () => {
    expect(reopen("closed")).toMatchObject({ kind: "ok", changes: { status: "open", closure_reason: null } });
    expect(reopen("open")).toMatchObject({ kind: "error", code: "invalid_transition" });
  });
});

describe("permission matrix", () => {
  const owner = { id: "u1", role: "agent" } as Agent;
  const other = { id: "u2", role: "agency_owner" } as Agent;
  const admin = { id: "a1", role: "admin" } as Agent;
  const open = { requester_id: "u1", status: "open" as const };
  const closed = { requester_id: "u1", status: "closed" as const };

  it("lets the owner comment and reopen but never manage", () => {
    expect(permissionsFor(owner, open)).toEqual({
      can_comment: true,
      can_add_internal_note: false,
      can_change_status: false,
      can_reopen: false,
      can_assign: false,
      can_edit_attributes: false,
      can_request_info: false,
      can_attach: true,
      can_remove_attachments: false,
    });
    expect(permissionsFor(owner, closed)).toMatchObject({ can_comment: false, can_reopen: true, can_attach: false });
  });

  it("gives nothing to another requester, even an agency owner", () => {
    expect(Object.values(permissionsFor(other, open)).some(Boolean)).toBe(false);
  });

  it("lets admins manage and leave internal notes on closed tickets", () => {
    expect(permissionsFor(admin, open)).toMatchObject({ can_change_status: true, can_assign: true, can_request_info: true });
    // Un admin que abre su propio ticket no se pide información a sí mismo.
    expect(permissionsFor(admin, { requester_id: "a1", status: "open" })).toMatchObject({ can_request_info: false });
    expect(permissionsFor(admin, closed)).toMatchObject({
      can_comment: false,
      can_add_internal_note: true,
      can_change_status: false,
      can_reopen: true,
    });
  });
});
