import type { ExecuteAppointmentResult } from "../domain/appointment-execution.js";

type HttpResponse = { statusCode: number; body: unknown };

export function appointmentExecutionResponse(result: ExecuteAppointmentResult): HttpResponse {
  if (!result.authenticated)
    return { statusCode: 401, body: { error: "unauthorized", message: "Inicia sesión para continuar." } };
  if (!result.authorized)
    return { statusCode: 404, body: { error: "not_found", message: "Conversación no encontrada." } };
  const outcome = result.result;
  switch (outcome.state) {
    case "archived":
      return { statusCode: 409, body: { error: "conversation_archived", message: "No puedes cambiar una cita desde una conversación archivada." } };
    case "client_not_selected":
      return { statusCode: 409, body: { error: "client_not_selected", message: "Selecciona un cliente antes de gestionar una cita." } };
    case "client_not_found":
      return { statusCode: 404, body: { error: "not_found", message: "Cliente no encontrado." } };
    case "invalid_confirmation":
      return { statusCode: 404, body: { error: "not_found", message: "Confirmación no encontrada." } };
    case "confirmation_already_used":
      return { statusCode: 409, body: { error: "confirmation_already_used", message: "La confirmación ya se utilizó; prepara una nueva operación." } };
    case "idempotency_key_reused":
      return { statusCode: 409, body: { error: "idempotency_key_reused", message: "La clave idempotente ya se usó con otra confirmación." } };
    case "replayed":
      return outcome.outcome === "succeeded"
        ? { statusCode: 200, body: { ...(outcome.resultSnapshot ?? {}), idempotent_replay: true } }
        : { statusCode: 409, body: outcome.resultSnapshot };
    case "rejected":
    case "conflict":
      return { statusCode: 409, body: outcome.resultSnapshot };
    case "succeeded":
      return { statusCode: 201, body: { ...outcome.resultSnapshot, idempotent_replay: false } };
  }
}
