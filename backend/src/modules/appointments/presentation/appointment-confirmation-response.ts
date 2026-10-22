import type { PrepareAppointmentConfirmationResult } from "../domain/appointment-confirmation.js";

type HttpResponse = { statusCode: number; body: unknown };

export function appointmentConfirmationResponse(result: PrepareAppointmentConfirmationResult): HttpResponse {
  if ("state" in result) {
    if (result.state === "invalid_shape")
      return { statusCode: 400, body: {
        error: "invalid_request",
        message: "Los campos enviados no corresponden a la acción solicitada.",
      } };
    const error = result.error;
    if (error.code === "ambiguous_local_time")
      return { statusCode: 409, body: {
        error: error.code,
        message: "La hora local ocurre dos veces; selecciona un offset UTC y vuelve a confirmar.",
        possible_instants: error.choices.map((choice) => ({
          start_at: choice.startAt,
          utc_offset_minutes: choice.utcOffsetMinutes,
        })),
      } };
    const errorMessages = {
      invalid_time_zone: "Usa una zona horaria IANA válida, por ejemplo America/Bogota.",
      invalid_local_datetime: "La fecha y hora local no son válidas.",
      nonexistent_local_time: "La hora local no existe por un cambio horario; elige otra hora.",
      invalid_utc_offset: "El offset no corresponde a la hora local y zona horaria indicadas.",
    };
    return { statusCode: 400, body: { error: error.code, message: errorMessages[error.code] } };
  }
  if (!result.authenticated)
    return { statusCode: 401, body: {
      error: "unauthorized",
      message: "Inicia sesión para continuar.",
    } };
  if (!result.authorized)
    return { statusCode: 404, body: {
      error: "not_found",
      message: "Conversación no encontrada.",
    } };
  switch (result.result.state) {
    case "archived":
      return { statusCode: 409, body: {
        error: "conversation_archived",
        message: "No puedes agendar en una conversación archivada.",
      } };
    case "client_not_selected":
      return { statusCode: 409, body: {
        error: "client_not_selected",
        message: "Selecciona un cliente antes de preparar la cita.",
      } };
    case "client_not_found":
    case "appointment_not_found":
      return { statusCode: 404, body: {
        error: "not_found",
        message: "Cita o cliente no encontrado.",
      } };
    case "agent_not_found":
      return { statusCode: 404, body: {
        error: "not_found",
        message: "Agente no encontrado o fuera de tu alcance.",
      } };
    case "invalid_request":
      return { statusCode: 400, body: {
        error: "invalid_request",
        message: "No se pudo preparar el intervalo solicitado.",
      } };
    case "confirmed_for_review":
      return { statusCode: 201, body: {
        confirmation: {
          id: result.result.confirmation.id,
          expires_at: result.result.confirmation.expiresAt,
          action: result.result.confirmation.action,
          appointment_id: result.result.confirmation.appointmentId,
          client_document_path:
            result.result.confirmation.clientDocumentPath,
          client_record_id: result.result.confirmation.clientRecordId,
          agent_account_id: result.result.confirmation.agentAccountId,
          interval: {
            start_at: result.result.confirmation.interval.startAt.toISOString(),
            end_at: result.result.confirmation.interval.endAt.toISOString(),
            duration_minutes:
              result.result.confirmation.interval.durationMinutes,
            time_zone: result.result.confirmation.interval.timeZone,
            start_local: result.result.confirmation.interval.startLocal,
            end_local: result.result.confirmation.interval.endLocal,
            start_utc_offset_minutes:
              result.result.confirmation.interval.startUtcOffsetMinutes,
          },
        },
      } };
  }
}
