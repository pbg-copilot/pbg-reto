import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { LocalDateTimeError, resolveLocalDateTime } from "./timezones.js";
import { getAuthorizedClientProfile, withAuthenticatedTransaction, withAuthorizedConversationTransaction } from "./authorization.js";
import { isAuthorizedAppointmentAgent } from "./appointment-authorization.js";
import { appointmentTargetFingerprint, publicAppointment } from "./appointment-presenter.js";
import { recordAppointmentAction } from "./appointment-audit-repository.js";
import type { AppointmentAction, AppointmentRow } from "./appointment-model.js";

type AppointmentRouteDependencies = { pool: Pool; digest: (token: string) => string; tokenOf: (request: any) => string };

export function registerAppointmentRoutes(app: FastifyInstance, { pool, digest, tokenOf }: AppointmentRouteDependencies) {
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
  app.get<{ Params: { conversationId: string } }>(
    "/api/conversations/:conversationId/appointments",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId"],
          properties: { conversationId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const result = await withAuthorizedConversationTransaction(
        pool,
        digest(tokenOf(req)),
        req.params.conversationId,
        async (client, conversation, principal) => {
          if (!conversation.active_client_path || !conversation.active_client_record_id)
            return { state: "client_not_selected" as const };
          if (
            !(await getAuthorizedClientProfile(
              client,
              principal,
              conversation.active_client_path,
              conversation.active_client_record_id,
            ))
          )
            return { state: "client_not_found" as const };
          const { rows } = await client.query(
            `SELECT id, conversation_id, client_document_path,
                    client_record_id, agent_account_id, start_at, end_at,
                    time_zone,
                    to_char(local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
                    start_utc_offset_minutes, status
               FROM reto.chat_appointments
              WHERE client_document_path = $1
                AND client_record_id = $2
                AND status = 'confirmed'
              ORDER BY start_at, id`,
            [
              conversation.active_client_path,
              conversation.active_client_record_id,
            ],
          );
          const authorized = [];
          for (const row of rows) {
            if (
              await isAuthorizedAppointmentAgent(
                client,
                principal,
                row.agent_account_id,
              )
            )
              authorized.push(publicAppointment(row));
          }
          return { state: "loaded" as const, appointments: authorized };
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
      if (result.result.state === "client_not_selected")
        return reply.code(409).send({
          error: "client_not_selected",
          message: "Selecciona un cliente para consultar sus citas.",
        });
      if (result.result.state === "client_not_found")
        return reply.code(404).send({
          error: "not_found",
          message: "Cliente no encontrado.",
        });
      return { appointments: result.result.appointments };
    },
  );
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
  app.post<{
    Params: { conversationId: string };
    Body: { confirmationId: string; idempotencyKey: string };
  }>(
    "/api/conversations/:conversationId/appointments",
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
          required: ["confirmationId", "idempotencyKey"],
          properties: {
            confirmationId: { type: "string", format: "uuid" },
            idempotencyKey: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (req, reply) => {
      const idempotencyFingerprint = createHash("sha256")
        .update(JSON.stringify({ confirmationId: req.body.confirmationId }))
        .digest("hex");
      const result = await withAuthorizedConversationTransaction(
        pool,
        digest(tokenOf(req)),
        req.params.conversationId,
        async (client, conversation, principal) => {
          await client.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`${principal.accountId}:${req.body.idempotencyKey}`],
          );
          const { rows: priorActions } = await client.query(
            `SELECT conversation_id, outcome, entity_type, entity_id, error_code,
                    idempotency_fingerprint, result_snapshot
               FROM reto.chat_actions
              WHERE actor_account_id = $1 AND idempotency_key = $2
              FOR UPDATE`,
            [principal.accountId, req.body.idempotencyKey],
          );
          if (priorActions.length) {
            const prior = priorActions[0];
            if (
              prior.conversation_id !== conversation.id ||
              prior.idempotency_fingerprint !== idempotencyFingerprint
            )
              return { state: "idempotency_key_reused" as const };
            return {
              state: "replayed" as const,
              outcome: prior.outcome as string,
              errorCode: prior.error_code as string | null,
              resultSnapshot: prior.result_snapshot as Record<string, unknown> | null,
            };
          }
  
          if (conversation.status !== "active")
            return { state: "archived" as const };
          if (!conversation.active_client_path || !conversation.active_client_record_id)
            return { state: "client_not_selected" as const };
          if (
            !(await getAuthorizedClientProfile(
              client,
              principal,
              conversation.active_client_path,
              conversation.active_client_record_id,
            ))
          )
            return { state: "client_not_found" as const };
  
          const { rows: confirmations } = await client.query(
            `SELECT id, conversation_id, requested_by_account_id, action,
                    appointment_id, client_document_path, client_record_id,
                    agent_account_id, start_at, end_at, time_zone,
                    to_char(local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
                    start_utc_offset_minutes, target_fingerprint, status,
                    expires_at
               FROM reto.chat_appointment_confirmations
              WHERE id = $1
                AND conversation_id = $2
                AND requested_by_account_id = $3
              FOR UPDATE`,
            [req.body.confirmationId, conversation.id, principal.accountId],
          );
          const confirmation = confirmations[0] as AppointmentRow | undefined;
          if (!confirmation) return { state: "invalid_confirmation" as const };
          const actionType =
            confirmation.action === "create"
              ? "appointment.created"
              : confirmation.action === "reschedule"
                ? "appointment.rescheduled"
                : "appointment.cancelled";
          const entityId =
            confirmation.appointment_id ?? confirmation.agent_account_id;
          const rejectedSnapshot = (error: string, message: string) => ({
            error,
            message,
            action: confirmation.action,
          });
          const rejectConfirmation = async (error: string, message: string) => {
            await client.query(
              `UPDATE reto.chat_appointment_confirmations
                  SET status = 'invalidated'
                WHERE id = $1 AND status = 'pending'`,
              [confirmation.id],
            );
            const resultSnapshot = rejectedSnapshot(error, message);
            await recordAppointmentAction(
              client,
              principal,
              conversation.id,
              actionType,
              entityId,
              "rejected",
              error,
              req.body.idempotencyKey,
              idempotencyFingerprint,
              resultSnapshot,
            );
            return { state: "rejected" as const, resultSnapshot };
          };
  
          if (confirmation.status !== "pending")
            return { state: "confirmation_already_used" as const };
          if (new Date(confirmation.expires_at).getTime() <= Date.now())
            return rejectConfirmation(
              "confirmation_expired",
              "La confirmación venció; prepara la cita nuevamente.",
            );
          if (
            confirmation.client_document_path !== conversation.active_client_path ||
            confirmation.client_record_id !== conversation.active_client_record_id
          )
            return rejectConfirmation(
              "stale_confirmation",
              "Cambió el cliente activo; confirma nuevamente los datos de la cita.",
            );
          if (
            !(await isAuthorizedAppointmentAgent(
              client,
              principal,
              confirmation.agent_account_id,
            ))
          )
            return rejectConfirmation(
              "stale_confirmation",
              "El agente ya no está dentro de tu alcance; prepara la cita nuevamente.",
            );
  
          let target: AppointmentRow | undefined;
          if (confirmation.appointment_id) {
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
                confirmation.appointment_id,
                conversation.id,
                conversation.active_client_path,
                conversation.active_client_record_id,
              ],
            );
            target = rows[0];
            if (
              !target ||
              appointmentTargetFingerprint(target) !==
                confirmation.target_fingerprint ||
              !(await isAuthorizedAppointmentAgent(
                client,
                principal,
                target.agent_account_id,
              ))
            )
              return rejectConfirmation(
                "stale_confirmation",
                "La cita cambió desde la confirmación; revisa y confirma de nuevo.",
              );
          }
  
          await client.query("SAVEPOINT appointment_write");
          let appointment: AppointmentRow;
          try {
            if (confirmation.action === "create") {
              const { rows } = await client.query(
                `INSERT INTO reto.chat_appointments(
                   conversation_id, client_document_path, client_record_id,
                   agent_account_id, created_by_account_id, start_at, end_at,
                   time_zone, local_start, start_utc_offset_minutes,
                   last_confirmation_id
                 ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING id, conversation_id, client_document_path,
                           client_record_id,
                           agent_account_id, start_at, end_at, time_zone,
                           to_char(local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
                           start_utc_offset_minutes, status`,
                [
                  conversation.id,
                  confirmation.client_document_path,
                  confirmation.client_record_id,
                  confirmation.agent_account_id,
                  principal.accountId,
                  confirmation.start_at,
                  confirmation.end_at,
                  confirmation.time_zone,
                  confirmation.local_start,
                  confirmation.start_utc_offset_minutes,
                  confirmation.id,
                ],
              );
              appointment = rows[0];
            } else if (confirmation.action === "reschedule") {
              const { rows } = await client.query(
                `UPDATE reto.chat_appointments
                    SET agent_account_id = $2,
                        start_at = $3,
                        end_at = $4,
                        time_zone = $5,
                        local_start = $6,
                        start_utc_offset_minutes = $7,
                        last_confirmation_id = $8
                  WHERE id = $1
                RETURNING id, conversation_id, client_document_path,
                          client_record_id,
                          agent_account_id, start_at, end_at, time_zone,
                          to_char(local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
                          start_utc_offset_minutes, status`,
                [
                  confirmation.appointment_id,
                  confirmation.agent_account_id,
                  confirmation.start_at,
                  confirmation.end_at,
                  confirmation.time_zone,
                  confirmation.local_start,
                  confirmation.start_utc_offset_minutes,
                  confirmation.id,
                ],
              );
              appointment = rows[0];
            } else {
              const { rows } = await client.query(
                `UPDATE reto.chat_appointments
                    SET status = 'cancelled', cancelled_at = now(),
                        last_confirmation_id = $2
                  WHERE id = $1
                RETURNING id, conversation_id, client_document_path,
                          client_record_id,
                          agent_account_id, start_at, end_at, time_zone,
                          to_char(local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
                          start_utc_offset_minutes, status`,
                [confirmation.appointment_id, confirmation.id],
              );
              appointment = rows[0];
            }
            await client.query("RELEASE SAVEPOINT appointment_write");
          } catch (error) {
            if (
              !error ||
              typeof error !== "object" ||
              !("code" in error) ||
              error.code !== "23P01"
            )
              throw error;
            await client.query("ROLLBACK TO SAVEPOINT appointment_write");
            await client.query("RELEASE SAVEPOINT appointment_write");
            await client.query(
              `UPDATE reto.chat_appointment_confirmations
                  SET status = 'invalidated'
                WHERE id = $1 AND status = 'pending'`,
              [confirmation.id],
            );
            const resultSnapshot = rejectedSnapshot(
              "slot_taken",
              "El intervalo se cruzó con otra cita confirmada. No se guardaron cambios.",
            );
            await recordAppointmentAction(
              client,
              principal,
              conversation.id,
              actionType,
              entityId,
              "conflict",
              "slot_taken",
              req.body.idempotencyKey,
              idempotencyFingerprint,
              resultSnapshot,
            );
            return { state: "conflict" as const, resultSnapshot };
          }
  
          await client.query(
            `UPDATE reto.chat_appointment_confirmations
                SET status = 'consumed', consumed_at = now()
              WHERE id = $1 AND status = 'pending'`,
            [confirmation.id],
          );
          const resultSnapshot = {
            action: confirmation.action,
            appointment: publicAppointment(appointment),
          };
          await recordAppointmentAction(
            client,
            principal,
            conversation.id,
            actionType,
            appointment.id,
            "succeeded",
            null,
            req.body.idempotencyKey,
            idempotencyFingerprint,
            resultSnapshot,
          );
          return { state: "succeeded" as const, resultSnapshot };
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
            message: "No puedes cambiar una cita desde una conversación archivada.",
          });
        case "client_not_selected":
          return reply.code(409).send({
            error: "client_not_selected",
            message: "Selecciona un cliente antes de gestionar una cita.",
          });
        case "client_not_found":
          return reply.code(404).send({
            error: "not_found",
            message: "Cliente no encontrado.",
          });
        case "invalid_confirmation":
          return reply.code(404).send({
            error: "not_found",
            message: "Confirmación no encontrada.",
          });
        case "confirmation_already_used":
          return reply.code(409).send({
            error: "confirmation_already_used",
            message: "La confirmación ya se utilizó; prepara una nueva operación.",
          });
        case "idempotency_key_reused":
          return reply.code(409).send({
            error: "idempotency_key_reused",
            message: "La clave idempotente ya se usó con otra confirmación.",
          });
        case "replayed":
          if (result.result.outcome === "succeeded")
            return reply.code(200).send({
              ...(result.result.resultSnapshot ?? {}),
              idempotent_replay: true,
            });
          if (result.result.outcome === "conflict")
            return reply.code(409).send(result.result.resultSnapshot);
          return reply.code(409).send(result.result.resultSnapshot);
        case "rejected":
          return reply.code(409).send(result.result.resultSnapshot);
        case "conflict":
          return reply.code(409).send(result.result.resultSnapshot);
        case "succeeded":
          return reply.code(201).send({
            ...result.result.resultSnapshot,
            idempotent_replay: false,
          });
      }
    },
  );
}
