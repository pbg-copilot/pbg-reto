import type { PendingAppointmentChatConfirmation } from "../domain/appointment-chat-state.js";
import type { AppointmentChatStateResult } from "../services/appointment-chat-state-service.js";

type HttpResponse = { statusCode: number; body: unknown };

function publicPendingConfirmation(row: PendingAppointmentChatConfirmation) {
  const start = new Date(row.start_at);
  const end = new Date(row.end_at);
  return {
    id: row.id,
    expires_at: row.expires_at,
    action: row.action,
    appointment_id: row.appointment_id,
    client_document_path: row.client_document_path,
    client_record_id: row.client_record_id,
    agent_account_id: row.agent_account_id,
    interval: {
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      duration_minutes: Math.round((end.getTime() - start.getTime()) / 60_000),
      time_zone: row.time_zone,
      start_local: String(row.local_start),
      end_local: new Intl.DateTimeFormat("sv-SE", {
        timeZone: row.time_zone,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hourCycle: "h23",
      }).format(end).replace(" ", "T"),
      start_utc_offset_minutes: row.start_utc_offset_minutes,
    },
  };
}

export function appointmentChatStateResponse(result: AppointmentChatStateResult): HttpResponse {
  if (!result.authenticated)
    return { statusCode: 401, body: { error: "unauthorized", message: "Inicia sesión para continuar." } };
  if (!result.authorized)
    return { statusCode: 404, body: { error: "not_found", message: "Conversación no encontrada." } };
  if (result.result.state === "confirmation")
    return { statusCode: 200, body: { state: "confirmation", confirmation: publicPendingConfirmation(result.result.confirmation) } };
  return { statusCode: 200, body: { state: result.result.state } };
}
