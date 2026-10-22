import type { CreateConversationResult, RenameConversationResult, ConversationHistoryResult } from "../services/conversation-management-service.js";

type HttpResponse = { statusCode: number; body: unknown };

function unauthorized(): HttpResponse {
  return { statusCode: 401, body: { error: "unauthorized", message: "Inicia sesión para continuar." } };
}

function notFound(): HttpResponse {
  return { statusCode: 404, body: { error: "not_found", message: "Conversación no encontrada." } };
}

export function createConversationResponse(result: CreateConversationResult): HttpResponse {
  if (!result.authenticated) return unauthorized();
  return { statusCode: 201, body: { conversation: result.result } };
}

export function renameConversationResponse(result: RenameConversationResult): HttpResponse {
  if ("state" in result)
    return { statusCode: 400, body: { error: "invalid_request", message: "El nombre de la conversación no puede estar vacío." } };
  if (!result.authenticated) return unauthorized();
  if (!result.authorized) return notFound();
  return { statusCode: 200, body: { conversation: result.result } };
}

export function conversationHistoryResponse(result: ConversationHistoryResult): HttpResponse {
  if ("state" in result)
    return { statusCode: 400, body: { error: "invalid_request", message: "El cursor de mensajes no es válido." } };
  if (!result.authenticated) return unauthorized();
  if (!result.authorized) return notFound();
  return { statusCode: 200, body: result.result };
}
