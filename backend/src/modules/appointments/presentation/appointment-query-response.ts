import type { AppointmentQueryResult } from "../services/appointment-query-service.js";
import { publicAppointment } from "./appointment-presenter.js";

type HttpResponse = { statusCode: number; body: unknown };

export function appointmentQueryResponse(result: AppointmentQueryResult): HttpResponse {
  if (!result.authenticated)
    return { statusCode: 401, body: { error: "unauthorized", message: "Inicia sesión para continuar." } };
  if (!result.authorized)
    return { statusCode: 404, body: { error: "not_found", message: "Conversación no encontrada." } };
  if (result.result.state === "client_not_selected")
    return { statusCode: 409, body: { error: "client_not_selected", message: "Selecciona un cliente para consultar sus citas." } };
  if (result.result.state === "client_not_found")
    return { statusCode: 404, body: { error: "not_found", message: "Cliente no encontrado." } };
  return { statusCode: 200, body: { appointments: result.result.appointments.map(publicAppointment) } };
}
