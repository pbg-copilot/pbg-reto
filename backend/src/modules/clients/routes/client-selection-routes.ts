import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { findAuthorizedClient, withOwnedConversationTransaction } from "../../../shared/auth/authorization.js";

export function registerClientSelectionRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies): void {
  app.post<{
    Params: { conversationId: string };
    Body: { documentPath: string; clientRecordId: string };
  }>(
    "/api/conversations/:conversationId/client",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["documentPath", "clientRecordId"],
          properties: {
            documentPath: {
              type: "string",
              minLength: 1,
              maxLength: 512,
              pattern: "^leads-store/books/[^\\s]+$",
            },
            clientRecordId: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await withOwnedConversationTransaction(
        pool,
        digest(tokenOf(req)),
        req.params.conversationId,
        async (client, principal, conversation) => {
          if (conversation.status !== "active")
            return { state: "archived" as const };
          const selected = await findAuthorizedClient(
            client,
            principal,
            req.body.documentPath,
            req.body.clientRecordId,
          );
          if (!selected) return { state: "not_found" as const };
          const changed =
            conversation.active_client_path !== selected.document_path ||
            conversation.active_client_record_id !== selected.client_record_id;
          if (changed) {
            await client.query(
              `UPDATE reto.chat_conversations
                  SET active_client_path = $2,
                      active_client_record_id = $3,
                      updated_at = now()
                WHERE id = $1`,
              [conversation.id, selected.document_path, selected.client_record_id],
            );
            await client.query(
              `INSERT INTO reto.chat_actions(
                 conversation_id, actor_account_id, actor_role, scope_agency_id,
                 action_type, entity_type, entity_id, outcome
               ) VALUES($1, $2, $3, $4, $5, 'client', $6, 'succeeded')`,
              [
                conversation.id,
                principal.accountId,
                principal.role,
                principal.agencyId,
                conversation.active_client_path ? "client.changed" : "client.selected",
                `${selected.document_path}#${selected.client_record_id}`,
              ],
            );
          }
          return { state: "selected" as const, changed, client: selected };
        },
      );
      if (!result.authenticated)
        return reply.code(401).send({
          error: "unauthorized",
          message: "Inicia sesión para continuar.",
        });
      if (!result.authorized || result.result.state === "not_found")
        return reply.code(404).send({
          error: "not_found",
          message: "Cliente o conversación no encontrado.",
        });
      if (result.result.state === "archived")
        return reply.code(409).send({
          error: "conversation_archived",
          message: "No se puede cambiar el cliente de una conversación archivada.",
        });
      return {
        client: result.result.client,
        changed: result.result.changed,
      };
    },
  );
}
