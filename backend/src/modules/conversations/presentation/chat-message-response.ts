import type { CreateChatMessageResult } from "../services/chat-message-service.js";

type HttpResponse = { statusCode: number; body: unknown };

export function chatMessageResponse(result: CreateChatMessageResult): HttpResponse {
  if ("state" in result)
    return { statusCode: 400, body: { error: "invalid_request", message: "El mensaje no puede estar vacío." } };
  if (!result.authenticated)
    return { statusCode: 401, body: { error: "unauthorized", message: "Inicia sesión para continuar." } };
  if (!result.authorized)
    return { statusCode: 404, body: { error: "not_found", message: "Conversación no encontrada." } };
  if (result.result.state === "archived")
    return { statusCode: 409, body: { error: "conversation_archived", message: "No se pueden agregar mensajes a una conversación archivada." } };
  return { statusCode: 201, body: { message: result.result.message } };
}
