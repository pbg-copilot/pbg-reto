import type { ClientSelectionResult } from "../services/client-selection-service.js";

type HttpResponse = { statusCode: number; body: unknown };

export function clientSelectionResponse(result: ClientSelectionResult): HttpResponse {
  if (!result.authenticated)
    return { statusCode: 401, body: { error: "unauthorized", message: "Inicia sesión para continuar." } };
  if (!result.authorized || result.result.state === "not_found")
    return { statusCode: 404, body: { error: "not_found", message: "Cliente o conversación no encontrado." } };
  if (result.result.state === "archived")
    return { statusCode: 409, body: { error: "conversation_archived", message: "No se puede cambiar el cliente de una conversación archivada." } };
  return { statusCode: 200, body: { client: result.result.client, changed: result.result.changed } };
}
