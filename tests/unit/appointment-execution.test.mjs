import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "../../backend/node_modules/fastify/fastify.js";
import { createAppointmentExecutionService } from "../../backend/dist/modules/appointments/appointment-execution-composition.js";
import { appointmentExecutionResponse } from "../../backend/dist/modules/appointments/presentation/appointment-execution-response.js";
import { appointmentTargetFingerprint } from "../../backend/dist/modules/appointments/presentation/appointment-presenter.js";
import { registerAppointmentExecutionRoutes } from "../../backend/dist/modules/appointments/routes/appointment-execution-routes.js";

const command = {
  tokenHash: "session-hash", conversationId: "11111111-1111-4111-8111-111111111111",
  confirmationId: "22222222-2222-4222-8222-222222222222", idempotencyKey: "33333333-3333-4333-8333-333333333333",
};

// Exercise the real composition and SQL adapters without a live PostgreSQL server.
// This records transaction boundaries; exclusion errors are injected explicitly.
function fixture(options = {}) {
  const trace = [];
  const principal = { id: "agent", role: "agent", agency_id: "agency" };
  const conversation = {
    id: command.conversationId, owner_account_id: "agent", title: "Cliente",
    status: "active", active_client_path: "leads-store/books/book.json", active_client_record_id: "client",
    ...options.conversation,
  };
  const target = {
    id: "44444444-4444-4444-8444-444444444444", conversation_id: conversation.id,
    client_document_path: conversation.active_client_path, client_record_id: conversation.active_client_record_id,
    agent_account_id: "agent", start_at: new Date("2099-10-22T15:00:00Z"), end_at: new Date("2099-10-22T15:30:00Z"),
    time_zone: "America/Bogota", local_start: "2099-10-22T10:00:00", start_utc_offset_minutes: -300,
    status: "confirmed", last_confirmation_id: "old-confirmation",
  };
  const confirmation = {
    ...target, id: command.confirmationId, action: options.action ?? "create", requested_by_account_id: principal.id,
    appointment_id: options.action && options.action !== "create" ? target.id : null,
    target_fingerprint: options.action && options.action !== "create" ? appointmentTargetFingerprint(target) : null,
    status: "pending", expires_at: new Date("2099-10-23T00:00:00Z"), ...options.confirmation,
  };
  let prior;
  const written = { ...target, status: confirmation.action === "cancel" ? "cancelled" : "confirmed" };
  const audit = [];
  const client = {
    async query(sql, params) {
      const statement = sql.replace(/\s+/g, " ").trim();
      trace.push({ statement, params });
      if (statement.includes("FROM reto.sessions")) return { rows: options.authenticated === false ? [] : [principal] };
      if (statement.includes("FROM reto.chat_conversations")) return { rows: options.authorized === false ? [] : [conversation] };
      if (statement.includes("FROM reto.chat_actions")) return { rows: prior ? [prior] : [] };
      if (statement.includes("FROM public.pbg_state_documents")) return { rows: options.clientFound === false ? [] : [{ name: "Cliente" }] };
      if (statement.includes("FROM reto.chat_appointment_confirmations")) return { rows: options.confirmationFound === false ? [] : [confirmation] };
      if (statement.includes("FROM onboarding.accounts")) return { rows: options.agentAllowed === false ? [] : [{ id: "agent" }] };
      if (statement.includes("FROM reto.chat_appointments")) return { rows: options.targetMissing ? [] : [{ ...target, ...options.target }] };
      if (statement.startsWith("INSERT INTO reto.chat_appointments") || statement.startsWith("UPDATE reto.chat_appointments")) {
        if (options.writeError) throw options.writeError;
        return { rows: [written] };
      }
      if (statement.startsWith("INSERT INTO reto.chat_actions")) {
        if (options.auditError) throw options.auditError;
        audit.push(params);
        prior = {
          conversation_id: params[0], outcome: params[6], error_code: params[7],
          idempotency_fingerprint: params[9], result_snapshot: JSON.parse(params[10]),
        };
      }
      if (statement.includes("SET status = 'invalidated'")) confirmation.status = "invalidated";
      if (statement.includes("SET status = 'consumed'")) confirmation.status = "consumed";
      return { rows: [] };
    },
    release(error) { trace.push({ statement: "release", error }); },
  };
  const pool = { async connect() { return client; } };
  return { service: createAppointmentExecutionService(pool), trace, confirmation, audit, written };
}

const authorizedResult = (result) => {
  assert.equal(result.authenticated, true);
  assert.equal(result.authorized, true);
  return result.result;
};
const writes = (trace) => trace.filter(({ statement }) => /^(INSERT INTO|UPDATE) reto\.chat_appointments\b/.test(statement));

for (const action of ["create", "reschedule", "cancel"]) {
  test(`${action}: write, consume and audit use one transaction; retry returns original snapshot`, async () => {
    const f = fixture({ action });
    const first = await f.service.execute(command);
    assert.equal(authorizedResult(first).state, "succeeded");
    assert.equal(first.result.resultSnapshot.action, action);
    assert.equal(first.result.resultSnapshot.appointment.status, action === "cancel" ? "cancelled" : "confirmed");
    assert.equal(f.confirmation.status, "consumed");
    assert.equal(f.audit.length, 1);
    assert.equal(f.audit[0][4], action === "create" ? "appointment.created" : action === "reschedule" ? "appointment.rescheduled" : "appointment.cancelled");
    const statements = f.trace.map((entry) => entry.statement);
    assert.equal(statements[0], "BEGIN");
    assert.ok(statements.some((s) => s.includes("FROM reto.chat_conversations") && s.endsWith("FOR UPDATE")));
    assert.ok(statements.some((s) => s.includes("FROM reto.chat_appointment_confirmations") && s.endsWith("FOR UPDATE")));
    assert.ok(statements.includes("SAVEPOINT appointment_write"));
    assert.ok(statements.indexOf("RELEASE SAVEPOINT appointment_write") < statements.findIndex((s) => s.includes("SET status = 'consumed'")));
    assert.ok(statements.findIndex((s) => s.startsWith("INSERT INTO reto.chat_actions")) < statements.indexOf("COMMIT"));
    assert.equal(appointmentExecutionResponse(first).statusCode, 201);
    // Later mutations of the target must not change the replayed snapshot.
    f.written.status = "cancelled";
    const replay = await f.service.execute(command);
    assert.equal(authorizedResult(replay).state, "replayed");
    assert.deepEqual(replay.result.resultSnapshot, first.result.resultSnapshot);
    assert.equal(appointmentExecutionResponse(replay).statusCode, 200);
    assert.equal(appointmentExecutionResponse(replay).body.idempotent_replay, true);
    assert.equal(writes(f.trace).length, 1);
    assert.equal(f.audit.length, 1);
    const mismatch = await f.service.execute({ ...command, confirmationId: "55555555-5555-4555-8555-555555555555" });
    assert.equal(authorizedResult(mismatch).state, "idempotency_key_reused");
    assert.equal(writes(f.trace).length, 1);
  });
}

test("overlap rolls back the write savepoint and commits a replayable conflict", async () => {
  const f = fixture({ writeError: Object.assign(new Error("overlap"), { code: "23P01" }) });
  const result = await f.service.execute(command);
  assert.equal(authorizedResult(result).state, "conflict");
  assert.equal(result.result.resultSnapshot.error, "slot_taken");
  assert.equal(f.confirmation.status, "invalidated");
  assert.equal(f.audit[0][6], "conflict");
  const statements = f.trace.map((entry) => entry.statement);
  assert.ok(statements.includes("ROLLBACK TO SAVEPOINT appointment_write"));
  assert.ok(statements.indexOf("ROLLBACK TO SAVEPOINT appointment_write") < statements.indexOf("RELEASE SAVEPOINT appointment_write"));
  assert.ok(statements.includes("COMMIT"));
  assert.ok(!statements.includes("ROLLBACK"));
  const replay = await f.service.execute(command);
  assert.deepEqual(appointmentExecutionResponse(replay), appointmentExecutionResponse(result));
  assert.equal(writes(f.trace).length, 1);
  assert.equal(f.audit.length, 1);
});

for (const [name, options, error] of [
  ["expired", { confirmation: { expires_at: "2000-01-01T00:00:00Z" } }, "confirmation_expired"],
  ["client changed", { confirmation: { client_record_id: "other" } }, "stale_confirmation"],
  ["agent lost access", { agentAllowed: false }, "stale_confirmation"],
  ["target changed", { action: "reschedule", target: { status: "cancelled" } }, "stale_confirmation"],
  ["target missing", { action: "cancel", targetMissing: true }, "stale_confirmation"],
]) {
  test(`${name}: reject without writing an appointment and replay the rejection`, async () => {
    const f = fixture(options);
    const first = await f.service.execute(command);
    assert.equal(authorizedResult(first).state, "rejected");
    assert.equal(first.result.resultSnapshot.error, error);
    assert.equal(f.confirmation.status, "invalidated");
    assert.equal(f.audit[0][6], "rejected");
    assert.equal(writes(f.trace).length, 0);
    const replay = await f.service.execute(command);
    assert.deepEqual(appointmentExecutionResponse(replay), appointmentExecutionResponse(first));
    assert.equal(f.audit.length, 1);
  });
}

for (const [name, options, state, httpStatus] of [
  ["archived", { conversation: { status: "archived" } }, "archived", 409],
  ["no client", { conversation: { active_client_record_id: null } }, "client_not_selected", 409],
  ["client not found", { clientFound: false }, "client_not_found", 404],
  ["confirmation not found", { confirmationFound: false }, "invalid_confirmation", 404],
  ["consumed confirmation", { confirmation: { status: "consumed" } }, "confirmation_already_used", 409],
]) {
  test(`${name}: preserve HTTP status and skip writes`, async () => {
    const f = fixture(options);
    const result = await f.service.execute(command);
    assert.equal(authorizedResult(result).state, state);
    assert.equal(appointmentExecutionResponse(result).statusCode, httpStatus);
    assert.equal(writes(f.trace).length, 0);
    assert.equal(f.audit.length, 0);
  });
}

for (const [name, options, status] of [
  ["expired session", { authenticated: false }, 401],
  ["unauthorized conversation", { authorized: false }, 404],
]) {
  test(`${name}: do not acquire the idempotency lock or write`, async () => {
    const f = fixture(options);
    const result = await f.service.execute(command);
    assert.equal(appointmentExecutionResponse(result).statusCode, status);
    assert.equal(writes(f.trace).length, 0);
    assert.ok(!f.trace.some(({ statement }) => statement.includes("pg_advisory_xact_lock")));
  });
}

for (const [name, options] of [
  ["unexpected database error", { writeError: Object.assign(new Error("offline"), { code: "08006" }) }],
  ["audit failure", { auditError: new Error("audit failed") }],
]) {
  test(`${name}: roll back the outer transaction instead of returning success`, async () => {
    const f = fixture(options);
    await assert.rejects(() => f.service.execute(command));
    const statements = f.trace.map((entry) => entry.statement);
    assert.ok(statements.includes("ROLLBACK"));
    assert.ok(!statements.includes("COMMIT"));
    assert.equal(statements.at(-1), "release");
  });
}

test("HTTP route validates UUIDs before invoking the injected executor", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const calls = [];
  registerAppointmentExecutionRoutes(app, {
    tokenOf: () => "token", digest: (value) => `hash:${value}`,
    appointmentExecution: { async execute(input) { calls.push(input); return { authenticated: true, authorized: true, result: { state: "succeeded", resultSnapshot: { action: "create", appointment: { id: "saved" } } } }; } },
  });
  const payload = { confirmationId: command.confirmationId, idempotencyKey: command.idempotencyKey };
  const valid = await app.inject({ method: "POST", url: `/api/conversations/${command.conversationId}/appointments`, payload });
  assert.equal(valid.statusCode, 201);
  assert.deepEqual(calls, [{ ...command, tokenHash: "hash:token" }]);
  assert.equal(valid.json().idempotent_replay, false);
  const invalid = await app.inject({ method: "POST", url: `/api/conversations/${command.conversationId}/appointments`, payload: { ...payload, confirmationId: "invalid" } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls.length, 1);
});
