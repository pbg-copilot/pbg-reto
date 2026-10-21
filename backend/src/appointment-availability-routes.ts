import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "./route-dependencies.js";
import { LocalDateTimeError, resolveLocalDateTime } from "./timezones.js";
import { withAuthenticatedTransaction } from "./authorization.js";

export function registerAppointmentAvailabilityRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies) {
  app.get<{
    Querystring: {
      agentAccountId: string;
      localStart: string;
      durationMinutes: number;
      timeZone: string;
      utcOffsetMinutes?: number;
    };
  }>(
    "/api/appointments/availability",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["agentAccountId", "localStart", "durationMinutes", "timeZone"],
          properties: {
            agentAccountId: { type: "string", minLength: 1, maxLength: 200 },
            localStart: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2})?$",
            },
            durationMinutes: { type: "integer", minimum: 1, maximum: 1440 },
            timeZone: {
              type: "string",
              minLength: 3,
              maxLength: 100,
              pattern: "^(UTC|[A-Za-z_]+/[A-Za-z0-9_+.-]+(?:/[A-Za-z0-9_+.-]+)*)$",
            },
            utcOffsetMinutes: { type: "integer", minimum: -840, maximum: 840 },
          },
        },
      },
    },
    async (req, reply) => {
      let interval;
      try {
        interval = resolveLocalDateTime(
          req.query.localStart,
          req.query.timeZone,
          req.query.durationMinutes,
          req.query.utcOffsetMinutes,
        );
      } catch (error) {
        if (!(error instanceof LocalDateTimeError)) throw error;
        if (error.code === "ambiguous_local_time")
          return reply.code(409).send({
            error: error.code,
            message:
            "La hora local ocurre dos veces por un cambio horario; selecciona un offset UTC y vuelve a consultar.",
            possible_instants: error.choices.map((choice) => ({
              start_at: choice.startAt,
              utc_offset_minutes: choice.utcOffsetMinutes,
            })),
          });
        const messages: Record<string, string> = {
          invalid_time_zone: "Usa una zona horaria IANA válida, por ejemplo America/Bogota.",
          invalid_local_datetime: "La fecha y hora local no son válidas.",
          nonexistent_local_time:
            "La hora local no existe por un cambio horario; elige otra hora.",
          invalid_utc_offset:
            "El offset no corresponde a la hora local y zona horaria indicadas.",
        };
        return reply.code(400).send({
          error: error.code,
          message: messages[error.code],
        });
      }
  
      const result = await withAuthenticatedTransaction(
        pool,
        digest(tokenOf(req)),
        async (client, principal) => {
          const { rows: agents } = await client.query(
            `SELECT id
               FROM onboarding.accounts
              WHERE id = $1
                AND role = 'agent'
                AND status = 'active'
                AND (
                  $2 = 'admin'
                  OR ($2 = 'agent' AND id = $3)
                  OR ($2 = 'agency_owner' AND agency_id = $4)
                )`,
            [
              req.query.agentAccountId,
              principal.role,
              principal.accountId,
              principal.agencyId,
            ],
          );
          if (!agents.length) return { state: "agent_not_found" as const };
          const { rows: conflicts } = await client.query(
            `SELECT id, start_at, end_at
               FROM reto.chat_appointments
              WHERE agent_account_id = $1
                AND status = 'confirmed'
                AND start_at < $3
                AND end_at > $2
              ORDER BY start_at, id`,
            [req.query.agentAccountId, interval.startAt, interval.endAt],
          );
          const { rows: calendarCounts } = await client.query(
            `SELECT count(*)::int AS confirmed_count
               FROM reto.chat_appointments
              WHERE agent_account_id = $1
                AND status = 'confirmed'`,
            [req.query.agentAccountId],
          );
          return {
            state: "loaded" as const,
            conflicts,
            confirmedCount: calendarCounts[0].confirmed_count as number,
          };
        },
      );
      if (!result.authenticated)
        return reply.code(401).send({
          error: "unauthorized",
          message: "Inicia sesión para continuar.",
        });
      if (result.result.state === "agent_not_found")
        return reply.code(404).send({
          error: "not_found",
          message: "Agente no encontrado o fuera de tu alcance.",
        });
  
      const conflicts = result.result.conflicts.map((row) => ({
        appointment_id: row.id,
        start_at: row.start_at,
        end_at: row.end_at,
      }));
      return {
        agent_account_id: req.query.agentAccountId,
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
      };
    },
  );
}
