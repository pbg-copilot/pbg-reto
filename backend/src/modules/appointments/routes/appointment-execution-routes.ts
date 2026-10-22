import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { createHash } from "node:crypto";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../../shared/auth/authorization.js";
import { isAuthorizedAppointmentAgent } from "../services/appointment-authorization.js";
import { appointmentTargetFingerprint, publicAppointment } from "../presentation/appointment-presenter.js";
import { recordAppointmentAction } from "../repositories/appointment-audit-repository.js";
import type { AppointmentRow } from "../domain/appointment-model.js";

export function registerAppointmentExecutionRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies) {
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
