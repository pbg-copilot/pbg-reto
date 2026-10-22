import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../../shared/auth/authorization.js";
import { isAuthorizedAppointmentAgent } from "../services/appointment-authorization.js";
import { publicAppointment } from "../presentation/appointment-presenter.js";

export function registerAppointmentQueryRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies) {
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
}
