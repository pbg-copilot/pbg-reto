import type { ListFollowUpsResult, CreateFollowUpResult, CompleteFollowUpResult } from "../services/follow-up-service.js";

type HttpResponse = { statusCode: number; body: unknown };

export function listFollowUpsResponse(result: ListFollowUpsResult): HttpResponse {
  if (!result.authenticated) return { statusCode: 401, body: { error: "unauthorized", message: "Inicia sesión para continuar." } };
  if (!result.authorized || result.result.state === "client_not_found")
    return { statusCode: 404, body: { error: "not_found", message: "Conversación o cliente no encontrado." } };
  if (result.result.state === "client_not_selected")
    return { statusCode: 409, body: { error: "client_not_selected", message: "Selecciona un cliente para consultar sus seguimientos." } };
  return { statusCode: 200, body: { client_name: result.result.clientName, follow_ups: result.result.followUps } };
}

export function createFollowUpResponse(result: CreateFollowUpResult): HttpResponse {
  if ("state" in result)
    return { statusCode: 400, body: { error: "invalid_request", message: "Escribe un detalle para el seguimiento." } };
  if (!result.authenticated) return { statusCode: 401, body: { error: "unauthorized", message: "Inicia sesión para continuar." } };
  if (!result.authorized || result.result.state === "client_not_found")
    return { statusCode: 404, body: { error: "not_found", message: "Conversación o cliente no encontrado." } };
  if (result.result.state === "forbidden")
    return { statusCode: 403, body: { error: "forbidden", message: "Solo un agente puede registrar seguimientos." } };
  if (result.result.state === "conversation_archived")
    return { statusCode: 409, body: { error: "conversation_archived", message: "No se puede registrar un seguimiento en una conversación archivada." } };
  if (result.result.state === "client_not_selected")
    return { statusCode: 409, body: { error: "client_not_selected", message: "Selecciona un cliente antes de registrar un seguimiento." } };
  if (result.result.state === "context_changed")
    return { statusCode: 409, body: { error: "context_changed", message: "El cliente activo cambió. Revisa la ficha e inténtalo otra vez." } };
  if (result.result.state === "past_date")
    return { statusCode: 400, body: { error: "date_in_past", message: "La fecha del seguimiento no puede estar en el pasado." } };
  return { statusCode: 201, body: { follow_up: result.result.followUp, client_name: result.result.clientName } };
}

export function completeFollowUpResponse(result: CompleteFollowUpResult): HttpResponse {
  if (!result.authenticated) return { statusCode: 401, body: { error: "unauthorized", message: "Inicia sesión para continuar." } };
  if (!result.authorized || result.result.state === "not_found")
    return { statusCode: 404, body: { error: "not_found", message: "Seguimiento pendiente no encontrado." } };
  if (result.result.state === "forbidden")
    return { statusCode: 403, body: { error: "forbidden", message: "Solo un agente puede cerrar seguimientos." } };
  if (result.result.state === "client_not_selected")
    return { statusCode: 409, body: { error: "client_not_selected", message: "Selecciona un cliente para continuar." } };
  if (result.result.state === "context_changed")
    return { statusCode: 409, body: { error: "context_changed", message: "El cliente activo cambió. Actualiza los seguimientos e inténtalo otra vez." } };
  return { statusCode: 200, body: { follow_up: result.result.followUp } };
}
