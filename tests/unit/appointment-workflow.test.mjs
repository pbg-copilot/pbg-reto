import test from "node:test";
import assert from "node:assert/strict";
import { buildAppointmentPreparePayload } from "../../frontend/src/features/appointments/domain/appointment-form.ts";
import { isCreateAppointmentRequest, isAppointmentListRequest, parseAppointmentDetails } from "../../frontend/src/features/appointments/domain/appointment-domain.ts";
import { executeAppointment, prepareAppointment, sendAppointmentChatTurn } from "../../frontend/src/features/appointments/services/appointment-api.ts";

const form = { action: "create", agentAccountId: "current-agent", date: "2026-10-22", time: "10:15", durationMinutes: 45 };
const appointment = { id: "saved-appointment", agent_account_id: "assigned-agent" };

test("manual creation prepares the active agent, local time and documented time zone", () => {
  assert.deepEqual(buildAppointmentPreparePayload({ ...form, appointment }), {
    valid: true, payload: { action: "create", agentAccountId: "current-agent", localStart: "2026-10-22T10:15", durationMinutes: 45, timeZone: "America/Bogota" },
  });
});

test("rescheduling retains the appointment's assigned agent and requires its ID", () => {
  assert.deepEqual(buildAppointmentPreparePayload({ ...form, action: "reschedule", appointment }), {
    valid: true, payload: { action: "reschedule", appointmentId: "saved-appointment", agentAccountId: "assigned-agent", localStart: "2026-10-22T10:15", durationMinutes: 45, timeZone: "America/Bogota" },
  });
});

test("cancellation sends only the action and selected appointment without requiring a date", () => {
  assert.deepEqual(buildAppointmentPreparePayload({ ...form, action: "cancel", appointment, date: "", time: "" }), {
    valid: true, payload: { action: "cancel", appointmentId: "saved-appointment" },
  });
});

for (const action of ["reschedule", "cancel"]) {
  test(`${action} rejects an absent appointment before preparing a request`, () => {
    assert.deepEqual(buildAppointmentPreparePayload({ ...form, action }), { valid: false, message: "Selecciona una cita vigente para continuar." });
  });
}

for (const action of ["create", "reschedule"]) {
  for (const field of ["date", "time"]) {
    test(`${action} requires ${field}`, () => {
      assert.deepEqual(buildAppointmentPreparePayload({ ...form, action, appointment, [field]: "" }), {
        valid: false, message: "Indica la fecha y la hora local de la cita.",
      });
    });
  }
}

test("chat accepts day/month/year and preserves an explicit IANA zone and duration", () => {
  assert.deepEqual(parseAppointmentDetails("21/10/2026 4:15 p.m. por 50 minutos America/New_York"), {
    localStart: "2026-10-21T16:15", durationMinutes: 50, timeZone: "America/New_York",
  });
  assert.deepEqual(parseAppointmentDetails("2026-10-21T09:05"), {
    localStart: "2026-10-21T09:05", durationMinutes: 30, timeZone: "America/Bogota",
  });
});

test("chat refuses impossible dates, invalid clock times and invalid durations", () => {
  for (const input of ["31/02/2026 10:00", "21/10/2026 24:00", "21/10/2026 10:60", "21/10/2026 13:00 pm", "21/10/2026 10:00 por 0 minutos", "21/10/2026 10:00 por 1441 minutos"])
    assert.equal(parseAppointmentDetails(input), null, input);
});

test("appointment requests still distinguish creation and agenda queries from ordinary questions", () => {
  assert.equal(isCreateAppointmentRequest("Quiero agendar una cita"), true);
  assert.equal(isAppointmentListRequest("¿Qué cita tiene el cliente?"), true);
  assert.equal(isCreateAppointmentRequest("Compara las cotizaciones"), false);
  assert.equal(isAppointmentListRequest("Compara las cotizaciones"), false);
});

test("preparing a review does not execute a write and retries preserve the confirmation and idempotency key", async () => {
  const calls = [];
  const api = async (url, init) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    return url.endsWith("/confirm") ? { confirmation: { id: "confirmation" } } : { action: "create", appointment: { id: "saved" } };
  };
  const prepared = buildAppointmentPreparePayload(form);
  assert.equal(prepared.valid, true);
  await prepareAppointment(api, "conversation", prepared.payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/conversations/conversation/appointments/confirm");
  await executeAppointment(api, "conversation", "confirmation", "same-key");
  await executeAppointment(api, "conversation", "confirmation", "same-key");
  assert.deepEqual(calls[1], calls[2]);
  assert.deepEqual(calls[1].body, { confirmationId: "confirmation", idempotencyKey: "same-key" });
});

test("chat turns retain the expected client and confirmation for backend context validation", async () => {
  const turn = { kind: "review", content: "21/10/2026 10:00", expectedClientPath: "leads-store/books/book.json", expectedClientRecordId: "client", confirmationId: "confirmation" };
  await sendAppointmentChatTurn(async (url, init) => {
    assert.equal(url, "/api/conversations/conversation/appointment-chat");
    assert.deepEqual(JSON.parse(init.body), turn);
    return { messages: [] };
  }, "conversation", turn);
});
