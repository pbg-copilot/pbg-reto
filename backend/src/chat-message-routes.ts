import type { FastifyInstance } from "fastify";
import { withAuthorizedConversationTransaction } from "./authorization.js";
import type { RouteDependencies } from "./route-dependencies.js";

export function registerChatMessageRoutes(
  app: FastifyInstance,
  { pool, digest, tokenOf }: RouteDependencies,
): void {
  app.post<{
    Params: { conversationId: string };
    Body: { content: string };
  }>(
    "/api/conversations/:conversationId/messages",
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
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 12000 },
          },
        },
      },
    },
    async (req, reply) => {
      const content = req.body.content.trim();
      if (!content)
        return reply.code(400).send({
          error: "invalid_request",
          message: "El mensaje no puede estar vacío.",
        });

      const result = await withAuthorizedConversationTransaction(
        pool,
        digest(tokenOf(req)),
        req.params.conversationId,
        async (client, conversation) => {
          if (conversation.status !== "active")
            return { state: "archived" as const };
          const { rows } = await client.query(
            `INSERT INTO reto.chat_messages(
               conversation_id, sender_role, content,
               client_document_path, client_record_id
             )
             VALUES($1, 'user', $2, $3, $4)
             RETURNING id, sequence_no, sender_role, content, created_at`,
            [conversation.id, content, conversation.active_client_path, conversation.active_client_record_id],
          );
          await client.query(
            "UPDATE reto.chat_conversations SET updated_at = now() WHERE id = $1",
            [conversation.id],
          );
          return { state: "saved" as const, message: rows[0] };
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
      if (result.result.state === "archived")
        return reply.code(409).send({
          error: "conversation_archived",
          message: "No se pueden agregar mensajes a una conversación archivada.",
        });
      return reply.code(201).send({ message: result.result.message });
    },
  );
}
