import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { listAuthorizedConversations, withAuthenticatedTransaction, withOwnedConversationTransaction, withAuthorizedConversationTransaction } from "../../../shared/auth/authorization.js";

export function registerConversationManagementRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies): void {
  app.get<{
    Querystring: { search?: string };
  }>("/api/conversations", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          search: { type: "string", minLength: 1, maxLength: 120 },
        },
      },
    },
  }, async (req, reply) => {
    const principal = req.principal;
    if (!principal)
      return reply.code(401).send({
        error: "unauthorized",
        message: "Inicia sesión para continuar.",
      });
    return {
      conversations: await listAuthorizedConversations(
        pool,
        principal,
        req.query.search?.trim() || undefined,
      ),
    };
  });
  app.post<{ Body: { title?: string } }>(
    "/api/conversations",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const token = tokenOf(req);
      const result = await withAuthenticatedTransaction(
        pool,
        digest(token),
        async (client, principal) => {
          const title = req.body.title?.trim() || null;
          const { rows } = await client.query(
            `INSERT INTO reto.chat_conversations(owner_account_id, title)
             VALUES($1, $2)
             RETURNING id, owner_account_id, title, status, active_client_path,
                       active_client_record_id, created_at, updated_at, archived_at`,
            [principal.accountId, title],
          );
          return rows[0];
        },
      );
      if (!result.authenticated)
        return reply.code(401).send({
          error: "unauthorized",
          message: "Inicia sesión para continuar.",
        });
      return reply.code(201).send({ conversation: result.result });
    },
  );
  app.patch<{
    Params: { conversationId: string };
    Body: { title: string };
  }>(
    "/api/conversations/:conversationId",
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
          required: ["title"],
          properties: { title: { type: "string", minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const title = req.body.title.trim();
      if (!title)
        return reply.code(400).send({
          error: "invalid_request",
          message: "El nombre de la conversación no puede estar vacío.",
        });
      const result = await withOwnedConversationTransaction(
        pool,
        digest(tokenOf(req)),
        req.params.conversationId,
        async (client, _principal, conversation) => {
          const { rows } = await client.query(
            `UPDATE reto.chat_conversations
                SET title = $2, updated_at = now()
              WHERE id = $1
              RETURNING id, owner_account_id, title, status, active_client_path,
                        active_client_record_id, created_at, updated_at, archived_at`,
            [conversation.id, title],
          );
          return rows[0];
        },
      );
      if (!result.authenticated)
        return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
      if (!result.authorized)
        return reply.code(404).send({ error: "not_found", message: "Conversación no encontrada." });
      return { conversation: result.result };
    },
  );
  app.get<{
    Params: { conversationId: string };
    Querystring: { limit?: number; beforeSequence?: string };
  }>(
    "/api/conversations/:conversationId",
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
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            beforeSequence: {
              type: "string",
              pattern: "^[1-9][0-9]{0,18}$",
            },
          },
        },
      },
    },
    async (req, reply) => {
      const limit = req.query.limit ?? 50;
      const beforeSequence = req.query.beforeSequence ?? null;
      if (
        beforeSequence !== null &&
        BigInt(beforeSequence) > 9223372036854775807n
      )
        return reply.code(400).send({
          error: "invalid_request",
          message: "El cursor de mensajes no es válido.",
        });
      const result = await withAuthorizedConversationTransaction(
        pool,
        digest(tokenOf(req)),
        req.params.conversationId,
        async (client, conversation) => {
          const { rows } = await client.query(
            `SELECT m.id, m.sequence_no, m.sender_role, m.content, m.created_at
               FROM reto.chat_messages AS m
               LEFT JOIN LATERAL (
                 SELECT a.entity_id
                   FROM reto.chat_actions AS a
                  WHERE a.conversation_id = m.conversation_id
                    AND a.action_type IN ('client.selected', 'client.changed')
                    AND a.outcome = 'succeeded'
                    AND a.occurred_at <= m.created_at
                  ORDER BY a.occurred_at DESC, a.id DESC
                  LIMIT 1
               ) AS context ON true
              WHERE m.conversation_id = $1
                AND (
                  ($2::text IS NULL
                   AND m.client_document_path IS NULL
                   AND m.client_record_id IS NULL
                   AND context.entity_id IS NULL)
                  OR
                  ($2::text IS NOT NULL AND (
                    (m.client_document_path = $2 AND m.client_record_id = $3)
                    OR (m.client_document_path IS NULL
                        AND m.client_record_id IS NULL
                        AND context.entity_id = $2 || '#' || $3)
                  ))
                )
                AND ($4::bigint IS NULL OR m.sequence_no < $4::bigint)
              ORDER BY m.sequence_no DESC
              LIMIT $5`,
            [conversation.id, conversation.active_client_path, conversation.active_client_record_id, beforeSequence, limit + 1],
          );
          const hasMore = rows.length > limit;
          const page = rows.slice(0, limit).reverse();
          return {
            conversation,
            messages: page,
            pagination: {
              limit,
              hasMore,
              nextBeforeSequence: hasMore ? page[0].sequence_no : null,
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
      return result.result;
    },
  );
}
