import type { FastifyInstance } from "fastify";
import {
  findAuthorizedClient,
  getAuthorizedClientProfile,
  getAuthorizedConversation,
  listAuthorizedConversations,
  searchAuthorizedClients,
  withAuthenticatedTransaction,
  withAuthorizedConversationTransaction,
  withOwnedConversationTransaction,
} from "./authorization.js";
import { isAuthorizedAppointmentAgent } from "./appointment-authorization.js";
import type { RouteDependencies } from "./route-dependencies.js";

export function registerConversationRoutes(
  app: FastifyInstance,
  { pool, digest, tokenOf }: RouteDependencies,
): void {
  app.get("/api/conversations", async (req, reply) => {
    const principal = req.principal;
    if (!principal)
      return reply.code(401).send({
        error: "unauthorized",
        message: "Inicia sesión para continuar.",
      });
    return {
      conversations: await listAuthorizedConversations(pool, principal),
    };
  });

  app.get<{ Querystring: { q: string; limit?: number } }>(
    "/api/clients",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["q"],
          properties: {
            q: { type: "string", minLength: 2, maxLength: 100 },
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
          },
        },
      },
    },
    async (req, reply) => {
      const principal = req.principal;
      if (!principal)
        return reply.code(401).send({
          error: "unauthorized",
          message: "Inicia sesión para continuar.",
        });
      const search = req.query.q.trim();
      if (search.length < 2)
        return reply.code(400).send({
          error: "invalid_request",
          message: "Escribe al menos dos caracteres para buscar.",
        });
      return {
        clients: await searchAuthorizedClients(
          pool,
          principal,
          search,
          req.query.limit ?? 20,
        ),
      };
    },
  );
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
