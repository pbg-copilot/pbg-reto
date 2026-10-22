import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { LocalDateTimeError, resolveLocalDateTime } from "../../../shared/time/timezones.js";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../../shared/auth/authorization.js";
import { isAuthorizedAppointmentAgent } from "../services/appointment-authorization.js";
import { appointmentTargetFingerprint } from "../presentation/appointment-presenter.js";
import type { AppointmentAction, AppointmentRow } from "../domain/appointment-model.js";

export function registerAppointmentConfirmationRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies) {
  app.post<{
    Params: { conversationId: string };
    Body: {
      action: AppointmentAction;
      appointmentId?: string;
      agentAccountId?: string;
      localStart?: string;
      durationMinutes?: number;
      timeZone?: string;
      utcOffsetMinutes?: number;
    };
  }>(
    "/api/conversations/:conversationId/appointments/confirm",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId"],
          properties: { conversationId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["action"],
          properties: {
            action: { type: "string", enum: ["create", "reschedule", "cancel"] },
            appointmentId: { type: "string", format: "uuid" },
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
      const body = req.body;
      const hasSchedule =
        body.localStart !== undefined ||
        body.durationMinutes !== undefined ||
        body.timeZone !== undefined ||
        body.utcOffsetMinutes !== undefined;
      const validShape =
        body.action === "create"
          ? body.appointmentId === undefined &&
            body.agentAccountId !== undefined &&
            body.localStart !== undefined &&
            body.durationMinutes !== undefined &&
            body.timeZone !== undefined
          : body.action === "reschedule"
            ? body.appointmentId !== undefined &&
              body.localStart !== undefined &&
              body.durationMinutes !== undefined &&
              body.timeZone !== undefined
            : body.appointmentId !== undefined &&
              body.agentAccountId === undefined &&
              !hasSchedule;
      if (!validShape)
        return reply.code(400).send({
          error: "invalid_request",
          message: "Los campos enviados no corresponden a la acción solicitada.",
        });
  
      let requestedInterval:
        | ReturnType<typeof resolveLocalDateTime>
        | undefined;
      if (body.action !== "cancel") {
        try {
          requestedInterval = resolveLocalDateTime(
            body.localStart!,
            body.timeZone!,
            body.durationMinutes!,
            body.utcOffsetMinutes,
          );
        } catch (error) {
          if (!(error instanceof LocalDateTimeError)) throw error;
          if (error.code === "ambiguous_local_time")
            return reply.code(409).send({
              error: error.code,
              message:
                "La hora local ocurre dos veces; selecciona un offset UTC y vuelve a confirmar.",
              possible_instants: error.choices.map((choice) => ({
                start_at: choice.startAt,
                utc_offset_minutes: choice.utcOffsetMinutes,
              })),
            });
          const errorMessages: Record<string, string> = {
            invalid_time_zone: "Usa una zona horaria IANA válida, por ejemplo America/Bogota.",
            invalid_local_datetime: "La fecha y hora local no son válidas.",
            nonexistent_local_time:
              "La hora local no existe por un cambio horario; elige otra hora.",
            invalid_utc_offset:
              "El offset no corresponde a la hora local y zona horaria indicadas.",
          };
          return reply.code(400).send({
            error: error.code,
            message: errorMessages[error.code],
          });
        }
      }
  
      const result = await withAuthorizedConversationTransaction(
        pool,
        digest(tokenOf(req)),
        req.params.conversationId,
        async (client, conversation, principal) => {
          if (conversation.status !== "active")
            return { state: "archived" as const };
          if (!conversation.active_client_path || !conversation.active_client_record_id)
            return { state: "client_not_selected" as const };
          const profile = await getAuthorizedClientProfile(
            client,
            principal,
            conversation.active_client_path,
            conversation.active_client_record_id,
          );
          if (!profile) return { state: "client_not_found" as const };
  
          let target: AppointmentRow | undefined;
          if (body.action !== "create") {
            const { rows } = await client.query(
              `SELECT id, conversation_id, client_document_path,
                      client_record_id, agent_account_id, start_at, end_at,
                      time_zone,
                      to_char(local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
                      start_utc_offset_minutes,
                      status, last_confirmation_id
                 FROM reto.chat_appointments
                WHERE id = $1
                  AND conversation_id = $2
                  AND client_document_path = $3
                  AND client_record_id = $4
                  AND status = 'confirmed'
                FOR UPDATE`,
              [
                body.appointmentId,
                conversation.id,
                conversation.active_client_path,
                conversation.active_client_record_id,
              ],
            );
            target = rows[0];
            if (!target) return { state: "appointment_not_found" as const };
            if (
              !(await isAuthorizedAppointmentAgent(
                client,
                principal,
                target.agent_account_id,
              ))
            )
              return { state: "appointment_not_found" as const };
          }
  
          const agentAccountId =
            body.action === "cancel"
              ? target!.agent_account_id
              : body.action === "reschedule"
                ? body.agentAccountId ?? target!.agent_account_id
                : body.agentAccountId!;
          if (
            !(await isAuthorizedAppointmentAgent(
              client,
              principal,
              agentAccountId,
            ))
          )
            return { state: "agent_not_found" as const };
  
          let interval = requestedInterval;
          let localStart = body.localStart;
          let targetFingerprint: string | null = null;
          if (target) {
            targetFingerprint = appointmentTargetFingerprint(target);
            if (body.action === "cancel") {
              localStart = String(target.local_start);
              const durationMinutes =
                (new Date(target.end_at).getTime() -
                  new Date(target.start_at).getTime()) /
                60_000;
              try {
                interval = resolveLocalDateTime(
                  localStart,
                  target.time_zone,
                  durationMinutes,
                  Number(target.start_utc_offset_minutes),
                );
              } catch {
                return { state: "appointment_not_found" as const };
              }
            }
          }
          if (!interval || !localStart)
            return { state: "invalid_request" as const };
  
          const { rows: confirmations } = await client.query(
            `INSERT INTO reto.chat_appointment_confirmations(
               conversation_id, requested_by_account_id, action,
               appointment_id, client_document_path, client_record_id,
               agent_account_id, start_at, end_at, time_zone, local_start,
               start_utc_offset_minutes, target_fingerprint
             ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             RETURNING id, expires_at`,
            [
              conversation.id,
              principal.accountId,
              body.action,
              target?.id ?? null,
              conversation.active_client_path,
              conversation.active_client_record_id,
              agentAccountId,
              interval.startAt,
              interval.endAt,
              interval.timeZone,
              localStart,
              interval.startUtcOffsetMinutes,
              targetFingerprint,
            ],
          );
          return {
            state: "confirmed_for_review" as const,
            confirmation: {
              id: confirmations[0].id as string,
              expiresAt: confirmations[0].expires_at as Date,
              action: body.action,
              appointmentId: target?.id ?? null,
              clientDocumentPath: conversation.active_client_path,
              clientRecordId: conversation.active_client_record_id,
              agentAccountId,
              interval,
            },
          };
        },
      );
      if (!result.authenticated)
        return reply.code(401).send({
          error: "unauthorized",
          message: "Inicia sesión para continuar.",
        });
      if (!result.authorized)
        return reply.code(404).send({
          error: "not_found",
          message: "Conversación no encontrada.",
        });
      switch (result.result.state) {
        case "archived":
          return reply.code(409).send({
            error: "conversation_archived",
            message: "No puedes agendar en una conversación archivada.",
          });
        case "client_not_selected":
          return reply.code(409).send({
            error: "client_not_selected",
            message: "Selecciona un cliente antes de preparar la cita.",
          });
        case "client_not_found":
        case "appointment_not_found":
          return reply.code(404).send({
            error: "not_found",
            message: "Cita o cliente no encontrado.",
          });
        case "agent_not_found":
          return reply.code(404).send({
            error: "not_found",
            message: "Agente no encontrado o fuera de tu alcance.",
          });
        case "invalid_request":
          return reply.code(400).send({
            error: "invalid_request",
            message: "No se pudo preparar el intervalo solicitado.",
          });
        case "confirmed_for_review":
          return reply.code(201).send({
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
          });
      }
    },
  );
}
