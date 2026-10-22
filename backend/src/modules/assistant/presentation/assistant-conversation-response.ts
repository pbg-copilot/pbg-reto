import type { AssistantConversationResult } from "../services/assistant-conversation-service.js";

type HttpResponse = { statusCode: number; body: unknown };
type FailureState = Exclude<AssistantConversationResult["state"], "saved">;
const failures: Record<FailureState, { statusCode: number; error: string; message: string }> = {
  invalid_request: { statusCode: 400, error: "invalid_request", message: "El mensaje no puede estar vacío." },
  unavailable: { statusCode: 503, error: "assistant_unavailable", message: "La redacción asistida no está habilitada para este entorno." },
  unauthorized: { statusCode: 401, error: "unauthorized", message: "Inicia sesión para continuar." },
  session_expired: { statusCode: 401, error: "unauthorized", message: "Tu sesión venció. Inicia sesión para continuar." },
  not_found: { statusCode: 404, error: "not_found", message: "Conversación o cliente no encontrado." },
  archived: { statusCode: 409, error: "conversation_archived", message: "No se pueden agregar mensajes a una conversación archivada." },
  client_not_selected: { statusCode: 409, error: "client_not_selected", message: "Selecciona un cliente antes de preguntar al asistente." },
  context_changed: { statusCode: 409, error: "context_changed", message: "El cliente activo cambió durante la consulta. Vuelve a enviar la pregunta para el cliente seleccionado." },
  provider_error: { statusCode: 502, error: "assistant_provider_error", message: "El proveedor de redacción no respondió correctamente. No se generó ni guardó una respuesta; inténtalo de nuevo." },
};

export function assistantConversationResponse(result: AssistantConversationResult): HttpResponse {
  if (result.state === "saved") return { statusCode: 201, body: { messages: result.messages } };
  const { statusCode, error, message } = failures[result.state];
  return { statusCode, body: { error, message } };
}
