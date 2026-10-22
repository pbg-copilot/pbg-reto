import type { AppointmentChatResult } from "../domain/appointment-chat.js";

type HttpResponse = { statusCode: number; body: unknown };

export function appointmentChatResponse(result: AppointmentChatResult): HttpResponse {
  if ("state" in result)
    return { statusCode: 400, body: { error: "invalid_request", message: result.state === "empty_content"
      ? "El mensaje no puede estar vacío."
      : "Faltan datos para responder en el chat de citas." } };
  if (!result.authenticated) return { statusCode: 401, body: { error: "unauthorized", message: "Inicia sesión para continuar." } };
  if (!result.authorized) return { statusCode: 404, body: { error: "not_found", message: "Conversación no encontrada." } };
  switch (result.result.state) {
    case "archived":
      return { statusCode: 409, body: { error: "conversation_archived", message: "No se puede agendar en una conversación archivada." } };
    case "agent_only":
      return { statusCode: 403, body: { error: "forbidden", message: "La agenda por chat está disponible para agentes." } };
    case "client_not_selected":
      return { statusCode: 409, body: { error: "client_not_selected", message: "Selecciona un cliente antes de crear una cita." } };
    case "client_not_found":
    case "confirmation_not_found":
    case "appointment_not_found":
    case "conflict_not_found":
      return { statusCode: 404, body: { error: "not_found", message: "No se encontró el cliente o la confirmación vigente." } };
    case "context_changed":
      return { statusCode: 409, body: { error: "context_changed", message: "Cambió el cliente activo. Vuelve a iniciar la solicitud de cita." } };
    case "saved":
      return { statusCode: 201, body: { messages: result.result.messages } };
  }
}
