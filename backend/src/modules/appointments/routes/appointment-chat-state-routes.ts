import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../../shared/auth/authorization.js";
import { isAuthorizedAppointmentAgent } from "../services/appointment-authorization.js";

export function registerAppointmentChatStateRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies): void {
  app.get<{ Params: { conversationId: string } }>(
    "/api/conversations/:conversationId/appointment-chat/state",
    {
      schema: {
        params: {
          type: "object", additionalProperties: false, required: ["conversationId"],
          properties: { conversationId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const result = await withAuthorizedConversationTransaction(
        pool, digest(tokenOf(req)), req.params.conversationId,
        async (client, conversation, principal) => {
          if (conversation.status !== "active" || principal.role !== "agent" || !conversation.active_client_path || !conversation.active_client_record_id)
            return { state: "idle" as const };
          if (!(await getAuthorizedClientProfile(client, principal, conversation.active_client_path, conversation.active_client_record_id)))
            return { state: "idle" as const };
          const { rows } = await client.query(
            `SELECT s.stage, c.id, c.expires_at, c.action, c.appointment_id,
                    c.client_document_path, c.client_record_id, c.agent_account_id,
                    c.start_at, c.end_at, c.time_zone,
                    to_char(c.local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
                    c.start_utc_offset_minutes
               FROM reto.chat_appointment_chat_state AS s
               LEFT JOIN reto.chat_appointment_confirmations AS c
                 ON c.id = s.confirmation_id AND c.status = 'pending' AND c.expires_at > now()
              WHERE (s.conversation_id = $1 AND s.requested_by_account_id = $2
                AND s.client_document_path = $3 AND s.client_record_id = $4
                AND s.stage = 'details') OR (
                  s.conversation_id = $1 AND s.requested_by_account_id = $2
                  AND s.client_document_path = $3 AND s.client_record_id = $4
                  AND s.stage = 'confirmation' AND c.id IS NOT NULL
                )
              LIMIT 1`,
            [conversation.id, principal.accountId, conversation.active_client_path, conversation.active_client_record_id],
          );
          const row = rows[0];
          if (!row) {
            await client.query(
              `DELETE FROM reto.chat_appointment_chat_state
                WHERE conversation_id = $1 AND requested_by_account_id = $2
                  AND (client_document_path <> $3 OR client_record_id <> $4
                       OR stage = 'confirmation')`,
              [conversation.id, principal.accountId, conversation.active_client_path, conversation.active_client_record_id],
            );
            return { state: "idle" as const };
          }
          if (row.stage === "details") return { state: "details" as const };
          if (!(await isAuthorizedAppointmentAgent(client, principal, row.agent_account_id)))
            return { state: "idle" as const };
          const durationMinutes = Math.round((new Date(row.end_at).getTime() - new Date(row.start_at).getTime()) / 60_000);
          const localStart = String(row.local_start);
          return {
            state: "confirmation" as const,
            confirmation: {
              id: row.id,
              expires_at: row.expires_at,
              action: row.action,
              appointment_id: row.appointment_id,
              client_document_path: row.client_document_path,
              client_record_id: row.client_record_id,
              agent_account_id: row.agent_account_id,
              interval: {
                start_at: new Date(row.start_at).toISOString(),
                end_at: new Date(row.end_at).toISOString(),
                duration_minutes: durationMinutes,
                time_zone: row.time_zone,
                start_local: localStart,
                end_local: new Intl.DateTimeFormat("sv-SE", {
                  timeZone: row.time_zone,
                  year: "numeric", month: "2-digit", day: "2-digit",
                  hour: "2-digit", minute: "2-digit", second: "2-digit",
                  hourCycle: "h23",
                }).format(new Date(row.end_at)).replace(" ", "T"),
                start_utc_offset_minutes: row.start_utc_offset_minutes,
              },
            },
          };
        },
      );
      if (!result.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
      if (!result.authorized) return reply.code(404).send({ error: "not_found", message: "Conversación no encontrada." });
      return reply.send(result.result);
    },
  );
}
