import type { AppointmentAvailabilityResult } from "../domain/appointment-availability.js";

type HttpResponse = { statusCode: number; body: unknown };

export function appointmentAvailabilityResponse(result: AppointmentAvailabilityResult): HttpResponse {
  if ("state" in result) {
    const error = result.error;
    if (error.code === "ambiguous_local_time")
      return { statusCode: 409, body: {
        error: error.code,
        message:
        "La hora local ocurre dos veces por un cambio horario; selecciona un offset UTC y vuelve a consultar.",
        possible_instants: error.choices.map((choice) => ({
          start_at: choice.startAt,
          utc_offset_minutes: choice.utcOffsetMinutes,
        })),
      } };
    const messages = {
      invalid_time_zone: "Usa una zona horaria IANA válida, por ejemplo America/Bogota.",
      invalid_local_datetime: "La fecha y hora local no son válidas.",
      nonexistent_local_time:
        "La hora local no existe por un cambio horario; elige otra hora.",
      invalid_utc_offset:
        "El offset no corresponde a la hora local y zona horaria indicadas.",
    };
    return { statusCode: 400, body: {
      error: error.code,
      message: messages[error.code],
    } };
  }
  if (!result.authenticated)
    return { statusCode: 401, body: { error: "unauthorized", message: "Inicia sesión para continuar." } };
  if (result.result.state === "agent_not_found")
    return { statusCode: 404, body: { error: "not_found", message: "Agente no encontrado o fuera de tu alcance." } };
  const { interval } = result.result;
  const conflicts = result.result.conflicts.map((row) => ({
    appointment_id: row.id,
    start_at: row.start_at,
    end_at: row.end_at,
  }));
  return { statusCode: 200, body: {
    agent_account_id: result.result.agentAccountId,
    availability_status: conflicts.length ? "conflict" : "no_conflict",
    interval: {
      start_at: interval.startAt.toISOString(),
      end_at: interval.endAt.toISOString(),
      duration_minutes: interval.durationMinutes,
      time_zone: interval.timeZone,
      start_local: interval.startLocal,
      end_local: interval.endLocal,
      start_utc_offset_minutes: interval.startUtcOffsetMinutes,
    },
    conflicts,
    calendar_status: result.result.confirmedCount ? "loaded" : "empty",
    confirmed_appointment_count: result.result.confirmedCount,
    availability_basis: "no_overlapping_confirmed_chat_appointments",
    limitations: [
      "No hay una política versionada de horario laboral o días festivos; la respuesta solo comprueba conflictos con citas confirmadas del calendario Chat PBG.",
    ],
  } };
}
