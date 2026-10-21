import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomBytes } from "node:crypto";
import { initializeDatabase, pool } from "./db.js";
import { checkPassword, hashPassword } from "./passwords.js";
import { loadAssistantConfig } from "./assistant-config.js";
import { OpenAiCompatibleAssistantProvider } from "./assistant-provider.js";
import { PostgresAssistantEvidenceRepository } from "./assistant-evidence-repository.js";
import { AssistantService } from "./assistant-service.js";
import { registerAppointmentRoutes } from "./appointment-routes.js";
import { isAuthorizedAppointmentAgent } from "./appointment-authorization.js";
import {
  listAuthorizedConversations,
  getAuthorizedAccount,
  getAuthorizedAgency,
  resolvePrincipal,
  findAuthorizedClient,
  getAuthorizedClientProfile,
  searchAuthorizedClients,
  withAuthenticatedTransaction,
  withAuthorizedConversationTransaction,
  withOwnedConversationTransaction,
  type Principal,
} from "./authorization.js";
const app = Fastify({
  logger: {
    level: "info",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
    ],
  },
  bodyLimit: 16384,
});
declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}
app.decorateRequest("principal", null);
await app.register(cookie);
await app.register(rateLimit, { global: false });
const ttlHours = Number(process.env.SESSION_TTL_HOURS || 8);
if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 24)
  throw new Error("Invalid SESSION_TTL_HOURS");
const allowedOrigin = process.env.APP_ORIGIN || "http://localhost:8088";
const assistantConfig = loadAssistantConfig();
const assistantService = new AssistantService(
  new PostgresAssistantEvidenceRepository(),
  new OpenAiCompatibleAssistantProvider(assistantConfig),
);
app.addHook("onRequest", async (req, reply) => {
  reply
    .header("Cache-Control", "no-store")
    .header("X-Content-Type-Options", "nosniff");
  if (req.headers.origin && req.headers.origin !== allowedOrigin)
    return reply
      .code(403)
      .send({ error: "origin_not_allowed", message: "Origen no permitido." });
});
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const tokenOf = (req: any): string => {
  if (req.headers.authorization)
    return /^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.authorization)
      ? req.headers.authorization.slice(7)
      : "";
  return req.cookies.reto_session || "";
};
async function currentAgent(req: any) {
  const token = tokenOf(req);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const principal =
    req.principal ?? (await resolvePrincipal(pool, digest(token)));
  if (!principal) return null;
  const account = await getAuthorizedAccount(
    pool,
    principal,
    principal.accountId,
  );
  if (!account) return null;
  const { rows } = await pool.query(
    "SELECT a.id,a.username,a.email,a.name,a.role,a.agency_id FROM reto.agents a WHERE a.id=$1",
    [principal.accountId],
  );
  if (!rows[0]) return null;
  const agency = principal.agencyId
    ? await getAuthorizedAgency(pool, principal, principal.agencyId)
    : null;
  return { ...rows[0], agency_name: agency?.name ?? null };
}
const publicRoutes = new Set([
  "/health",
  "/auth/get-toke",
  "/auth/logout",
]);
app.addHook("preHandler", async (req, reply) => {
  const routePath = req.routeOptions.url;
  if (routePath && publicRoutes.has(routePath)) return;

  const token = tokenOf(req);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    return reply.code(401).send({
      error: "unauthorized",
      message: "Inicia sesión para continuar.",
    });

  req.principal = await resolvePrincipal(pool, digest(token));
  if (!req.principal)
    return reply.code(401).send({
      error: "unauthorized",
      message: "Inicia sesión para continuar.",
    });
});
app.get("/health", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ok", service: "reto-api", database: "ok" };
  } catch {
    return reply.code(503).send({
      status: "unavailable",
      service: "reto-api",
      database: "unavailable",
    });
  }
});
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
app.get("/api/assistant/status", async () => ({
  enabled: assistantService.isEnabled(),
  provider: assistantConfig.provider,
  model: assistantService.isEnabled() ? assistantConfig.model : null,
  externalDataAuthorized: assistantConfig.externalDataAuthorized,
}));
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
app.get<{
  Params: { conversationId: string };
  Querystring: {
    limit?: number;
    beforeNoteIndex?: string;
    beforeActivityIndex?: string;
  };
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
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
          beforeNoteIndex: {
            type: "string",
            pattern: "^[1-9][0-9]{0,18}$",
          },
          beforeActivityIndex: {
            type: "string",
            pattern: "^[1-9][0-9]{0,18}$",
          },
        },
      },
    },
  },
  async (req, reply) => {
    const limit = req.query.limit ?? 20;
    const beforeNoteIndex = req.query.beforeNoteIndex ?? null;
    const beforeActivityIndex = req.query.beforeActivityIndex ?? null;
    if (
      (beforeNoteIndex !== null &&
        BigInt(beforeNoteIndex) > 9223372036854775807n) ||
      (beforeActivityIndex !== null &&
        BigInt(beforeActivityIndex) > 9223372036854775807n)
    )
      return reply.code(400).send({
        error: "invalid_request",
        message: "El cursor de notas o actividad no es válido.",
      });
    const result = await withAuthorizedConversationTransaction(
      pool,
      digest(tokenOf(req)),
      req.params.conversationId,
      async (client, conversation, principal) => {
        if (!conversation.active_client_path || !conversation.active_client_record_id)
          return { state: "client_not_selected" as const };
        const profile = await getAuthorizedClientProfile(
          client,
          principal,
          conversation.active_client_path,
          conversation.active_client_record_id,
        );
        if (!profile) return { state: "not_found" as const };
        const { rows } = await client.query(
          `SELECT note.ordinality::text AS note_index,
                  COALESCE(NULLIF(note.value->>'id', ''), note.ordinality::text) AS note_id,
                  NULLIF(note.value->>'callId', '') AS call_id,
                  note.value->'text' AS text,
                  CASE WHEN jsonb_typeof(note.value->'at') = 'number'
                            AND (note.value->>'at')::numeric BETWEEN 0 AND 4102444800000
                    THEN to_timestamp((note.value->>'at')::double precision / 1000.0)
                    ELSE NULL END AS occurred_at
             FROM public.pbg_state_documents AS d
             JOIN onboarding.accounts AS owner
               ON owner.id = d.document->>'ownerKey'
              AND owner.status = 'active'
              AND owner.role IN ('agent', 'agency_owner')
             CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(d.document->'leads') = 'array'
                 THEN d.document->'leads' ELSE '[]'::jsonb END
             ) AS lead
             CROSS JOIN LATERAL jsonb_array_elements(
               CASE WHEN jsonb_typeof(lead->'notes') = 'array'
                 THEN lead->'notes' ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS note(value, ordinality)
            WHERE d.path = $1
              AND d.path LIKE 'leads-store/books/%'
              AND jsonb_typeof(d.document) = 'object'
              AND jsonb_typeof(lead) = 'object'
              AND lead->>'id' = $2
              AND jsonb_typeof(note.value) = 'object'
              AND (
                jsonb_typeof(note.value->'text') = 'string'
                OR (jsonb_typeof(note.value->'text') = 'object'
                    AND (jsonb_typeof(note.value->'text'->'es') = 'string'
                         OR jsonb_typeof(note.value->'text'->'en') = 'string'))
              )
              AND (
                $3 = 'admin'
                OR ($3 = 'agent' AND owner.id = $4)
                OR ($3 = 'agency_owner' AND owner.role = 'agent'
                    AND owner.agency_id = $5)
              )
              AND ($6::bigint IS NULL OR note.ordinality < $6::bigint)
            ORDER BY note.ordinality DESC
            LIMIT $7`,
          [
            profile.document_path,
            profile.client_record_id,
            principal.role,
            principal.accountId,
            principal.agencyId,
            beforeNoteIndex,
            limit + 1,
          ],
        );
        const activityResult = await client.query(
          `WITH scoped_lead AS (
             SELECT lead
               FROM public.pbg_state_documents AS d
               JOIN onboarding.accounts AS owner
                 ON owner.id = d.document->>'ownerKey'
                AND owner.status = 'active'
                AND owner.role IN ('agent', 'agency_owner')
               CROSS JOIN LATERAL jsonb_array_elements(
                 CASE WHEN jsonb_typeof(d.document->'leads') = 'array'
                   THEN d.document->'leads' ELSE '[]'::jsonb END
               ) AS lead
              WHERE d.path = $1
                AND d.path LIKE 'leads-store/books/%'
                AND jsonb_typeof(d.document) = 'object'
                AND jsonb_typeof(lead) = 'object'
                AND lead->>'id' = $2
                AND (
                  $3 = 'admin'
                  OR ($3 = 'agent' AND owner.id = $4)
                  OR ($3 = 'agency_owner' AND owner.role = 'agent'
                      AND owner.agency_id = $5)
                )
           ), eligible AS (
             SELECT note.ordinality,
                    COALESCE(NULLIF(note.value->>'id', ''), note.ordinality::text) AS note_id,
                    note.value->>'callId' AS call_id,
                    CASE WHEN jsonb_typeof(note.value->'at') = 'number'
                               AND (note.value->>'at')::numeric BETWEEN 0 AND 4102444800000
                      THEN to_timestamp((note.value->>'at')::double precision / 1000.0)
                      ELSE NULL END AS occurred_at
               FROM scoped_lead
               CROSS JOIN LATERAL jsonb_array_elements(
                 CASE WHEN jsonb_typeof(lead->'notes') = 'array'
                   THEN lead->'notes' ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS note(value, ordinality)
              WHERE jsonb_typeof(note.value) = 'object'
                AND NULLIF(note.value->>'callId', '') IS NOT NULL
                AND CASE WHEN jsonb_typeof(note.value->'at') = 'number'
                    THEN (note.value->>'at')::numeric BETWEEN 0 AND 4102444800000
                    ELSE false END
           ), page AS (
             SELECT * FROM eligible
              WHERE $6::bigint IS NULL OR ordinality < $6::bigint
              ORDER BY ordinality DESC
              LIMIT $7
           )
           SELECT page.ordinality::text AS activity_index,
                  page.note_id,
                  page.call_id,
                  page.occurred_at,
                  (SELECT count(*) FROM eligible)::integer AS total_count
             FROM (SELECT 1) AS seed
             LEFT JOIN page ON true
            ORDER BY page.ordinality DESC`,
          [
            profile.document_path,
            profile.client_record_id,
            principal.role,
            principal.accountId,
            principal.agencyId,
            beforeActivityIndex,
            limit + 1,
          ],
        );
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit).reverse();
        const notes = page.map((note) => {
          const rawText = note.text as unknown;
          const text =
            typeof rawText === "string"
              ? { original: rawText.slice(0, 4000), truncated: rawText.length > 4000 }
              : rawText && typeof rawText === "object" && !Array.isArray(rawText)
                ? {
                    es:
                      typeof (rawText as Record<string, unknown>).es === "string"
                        ? ((rawText as Record<string, string>).es).slice(0, 4000)
                        : null,
                    en:
                      typeof (rawText as Record<string, unknown>).en === "string"
                        ? ((rawText as Record<string, string>).en).slice(0, 4000)
                        : null,
                    truncated:
                      (((rawText as Record<string, unknown>).es as string | undefined)?.length ?? 0) > 4000 ||
                      (((rawText as Record<string, unknown>).en as string | undefined)?.length ?? 0) > 4000,
                  }
                : { original: null, truncated: false };
          const occurredAt = note.occurred_at as Date | null;
          return {
            id: note.note_id as string,
            index: note.note_index as string,
            call_id: note.call_id as string | null,
            text,
            occurred_at: occurredAt,
            source: {
              type: "client_note",
              document_path: profile.document_path,
              client_record_id: profile.client_record_id,
              note_id: note.note_id,
              note_index: note.note_index,
              date: occurredAt,
            },
          };
        });
        const missing: string[] = [
          ...(["name", "email", "phone", "stage"] as const).filter(
            (field) => profile[field] === null,
          ),
        ];
        if (profile.notes_type === null || profile.notes_count === 0)
          missing.push("notes");
        if (profile.calls_type !== null && profile.calls_type !== "array")
          missing.push("calls: formato no compatible");
        else if (profile.calls_count > 0)
          missing.push("calls: las entradas originales no tienen fecha ni estructura verificables");
        const activityRows = activityResult.rows.filter(
          (entry) => entry.activity_index !== null,
        );
        const activityHasMore = activityRows.length > limit;
        const activityPage = activityRows.slice(0, limit).reverse();
        const activityEntries = activityPage.map((entry) => ({
            type: "call_note",
            call_id: entry.call_id as string,
            note_id: entry.note_id as string,
            occurred_at: entry.occurred_at as Date,
            source: {
              type: "client_note",
              document_path: profile.document_path,
              client_record_id: profile.client_record_id,
              note_id: entry.note_id,
              note_index: entry.activity_index,
              date: entry.occurred_at,
            },
          }));
        const activityCount = Number(activityResult.rows[0]?.total_count ?? 0);
        return {
          state: "loaded" as const,
          profile,
          notes,
          activityEntries,
          activityHasMore,
          nextBeforeActivityIndex: activityHasMore
            ? activityPage[0].activity_index
            : null,
          activityCount,
          hasMore,
          nextBeforeNoteIndex: hasMore ? page[0].note_index : null,
          missing,
        };
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
        message: "Conversación o cliente no encontrado.",
      });
    if (result.result.state === "client_not_selected")
      return reply.code(409).send({
        error: "client_not_selected",
        message: "Selecciona un cliente antes de consultar su expediente.",
      });
    const {
      profile,
      notes,
      activityEntries,
      activityHasMore,
      nextBeforeActivityIndex,
      activityCount,
      hasMore,
      nextBeforeNoteIndex,
      missing,
    } = result.result;
    return {
      client: {
        id: profile.client_record_id,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        stage: profile.stage,
      },
      source: {
        type: "client_record",
        document_path: profile.document_path,
        client_record_id: profile.client_record_id,
        date: profile.modified_at,
      },
      notes,
      notes_status:
        profile.notes_type === null ||
        (profile.notes_type === "array" && profile.notes_count === 0)
          ? "empty"
          : notes.length > 0
            ? "loaded"
            : beforeNoteIndex !== null
              ? "empty"
              : "unavailable",
      notes_pagination: {
        limit,
        hasMore,
        nextBeforeNoteIndex,
      },
      activity: {
        status:
          activityCount > 0
            ? "partial"
            : profile.calls_type === null ||
                (profile.calls_type === "array" && profile.calls_count === 0)
              ? "empty"
              : "unavailable",
        entries: activityEntries,
        pagination: {
          limit,
          hasMore: activityHasMore,
          nextBeforeActivityIndex,
          total: activityCount,
        },
        reason:
          activityCount === 0 &&
          (profile.calls_type === null ||
            (profile.calls_type === "array" && profile.calls_count === 0))
            ? null
            : "Solo se muestran notas con callId y fecha verificables; las entradas de llamadas originales no se interpretan.",
      },
      missing,
    };
  },
);
app.get<{ Params: { conversationId: string } }>(
  "/api/conversations/:conversationId/quotes",
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
        const profile = await getAuthorizedClientProfile(
          client,
          principal,
          conversation.active_client_path,
          conversation.active_client_record_id,
        );
        if (!profile) return { state: "not_found" as const };
        const { rows } = await client.query(
          `WITH scoped_lead AS (
             SELECT owner.id AS owner_id, lead->>'id' AS client_record_id,
                    count(*) OVER () AS matching_lead_count
               FROM public.pbg_state_documents AS d
               JOIN onboarding.accounts AS owner
                 ON owner.id = d.document->>'ownerKey'
                AND owner.status = 'active'
                AND owner.role IN ('agent', 'agency_owner')
               CROSS JOIN LATERAL jsonb_array_elements(
                 CASE WHEN jsonb_typeof(d.document->'leads') = 'array'
                   THEN d.document->'leads' ELSE '[]'::jsonb END
               ) AS lead
              WHERE d.path = $1
                AND d.path LIKE 'leads-store/books/%'
                AND jsonb_typeof(d.document) = 'object'
                AND jsonb_typeof(lead) = 'object'
                AND lead->>'id' = $2
                AND (
                  $3 = 'admin'
                  OR ($3 = 'agent' AND owner.id = $4)
                  OR ($3 = 'agency_owner' AND owner.role = 'agent'
                      AND owner.agency_id = $5)
                )
           )
           SELECT q.quote_id, q.carrier, q.product,
                  q.face_amount_cents, q.monthly_premium_cents,
                  q.annual_premium_cents, q.created_at
             FROM scoped_lead AS lead
             JOIN analytics.quotes AS q
               ON q.lead_id = lead.client_record_id
              AND q.account_id = lead.owner_id
            WHERE lead.matching_lead_count = 1
            ORDER BY q.created_at NULLS LAST, q.quote_id`,
          [
            profile.document_path,
            profile.client_record_id,
            principal.role,
            principal.accountId,
            principal.agencyId,
          ],
        );
        const quotes = rows.map((quote) => ({
          id: quote.quote_id as string,
          carrier: quote.carrier as string | null,
          product: quote.product as string | null,
          face_amount_cents: quote.face_amount_cents as string | null,
          monthly_premium_cents: quote.monthly_premium_cents as string | null,
          annual_premium_cents: quote.annual_premium_cents as string | null,
          recorded_at: quote.created_at as string | null,
          source: {
            type: "analytics_quote_snapshot",
            table: "analytics.quotes",
            record_id: quote.quote_id,
            client_record_id: profile.client_record_id,
            date: quote.created_at,
            match_basis: "exact_lead_id_and_owner_account_id",
          },
        }));
        const missing = [
          ...(!quotes.length
            ? ["no hay registros con coincidencia exacta de lead_id y account_id"]
            : []),
          "reglas versionadas de elegibilidad, cobertura y tarifas",
          "confirmación de vigencia y aprobación de los importes analíticos",
        ];
        for (const quote of quotes) {
          if (!quote.carrier) missing.push(`cotización ${quote.id}: carrier`);
          if (!quote.product) missing.push(`cotización ${quote.id}: product`);
          if (quote.face_amount_cents === null)
            missing.push(`cotización ${quote.id}: face_amount_cents`);
          if (quote.monthly_premium_cents === null)
            missing.push(`cotización ${quote.id}: monthly_premium_cents`);
          if (quote.annual_premium_cents === null)
            missing.push(`cotización ${quote.id}: annual_premium_cents`);
        }
        return {
          state: "loaded" as const,
          clientRecordId: conversation.active_client_record_id,
          quotes,
          missing,
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
    if (result.result.state === "not_found")
      return reply.code(404).send({
        error: "not_found",
        message: "Conversación o cliente no encontrado.",
      });
    if (result.result.state === "client_not_selected")
      return reply.code(409).send({
        error: "client_not_selected",
        message: "Selecciona un cliente antes de consultar sus cotizaciones.",
      });
    return {
      client_record_id: result.result.clientRecordId,
      quotes_status: result.result.quotes.length ? "loaded" : "empty",
      quotes: result.result.quotes,
      comparison_status:
        result.result.quotes.length > 1
          ? "observed_fields_only"
          : result.result.quotes.length === 1
            ? "single_record"
            : "empty",
      comparison: {
        quote_ids: result.result.quotes.map((quote) => quote.id),
        records: result.result.quotes.map((quote) => ({
          quote_id: quote.id,
          carrier: quote.carrier,
          product: quote.product,
          face_amount_cents: quote.face_amount_cents,
          monthly_premium_cents: quote.monthly_premium_cents,
          annual_premium_cents: quote.annual_premium_cents,
          recorded_at: quote.recorded_at,
          source_record_id: quote.source.record_id,
        })),
        fields: [
          "carrier",
          "product",
          "face_amount_cents",
          "monthly_premium_cents",
          "annual_premium_cents",
          "recorded_at",
        ],
        interpretation: "stored_values_only",
      },
      rules: {
        status: "unavailable",
        version: null,
        reason: "No se encontró un catálogo de reglas versionado en el respaldo.",
      },
      record_semantics: {
        kind: "analytics_snapshot",
        meaning:
          "Valores registrados en analytics.quotes asociados por coincidencia exacta de IDs; no representan por sí solos una oferta vigente, aprobada o emitida.",
        fields: {
          face_amount_cents:
            "Valor nominal almacenado; no confirma cobertura contratada.",
          monthly_premium_cents:
            "Importe mensual almacenado; no confirma tarifa vigente.",
          annual_premium_cents:
            "Importe anual almacenado; no confirma tarifa vigente.",
          recorded_at:
            "Fecha de registro analítico; no es fecha de emisión o vigencia.",
        },
      },
      source: {
        table: "analytics.quotes",
        relationship_status: "exact_key_match_association_only",
      },
      missing: result.result.missing,
    };
  },
);
registerAppointmentRoutes(app, { pool, digest, tokenOf });
app.post<{
  Params: { conversationId: string };
  Body: { content: string };
}>(
  "/api/conversations/:conversationId/assistant",
  {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      params: { type: "object", additionalProperties: false, required: ["conversationId"], properties: { conversationId: { type: "string", format: "uuid" } } },
      body: { type: "object", additionalProperties: false, required: ["content"], properties: { content: { type: "string", minLength: 1, maxLength: 4000 } } },
    },
  },
  async (req, reply) => {
    const content = req.body.content.trim();
    if (!content) return reply.code(400).send({ error: "invalid_request", message: "El mensaje no puede estar vacío." });
    if (!assistantService.isEnabled()) return reply.code(503).send({ error: "assistant_unavailable", message: "La redacción asistida no está habilitada para este entorno." });

    const readAuthorizedEvidence = () => withAuthorizedConversationTransaction(
      pool, digest(tokenOf(req)), req.params.conversationId,
      async (client, conversation, principal) => {
        if (conversation.status !== "active") return { state: "archived" as const };
        return assistantService.loadEvidence(client, conversation, principal);
      },
    );
    const evidenceResult = await readAuthorizedEvidence();
    if (!evidenceResult.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
    if (!evidenceResult.authorized || evidenceResult.result.state === "not_found") return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
    if (evidenceResult.result.state === "archived") return reply.code(409).send({ error: "conversation_archived", message: "No se pueden agregar mensajes a una conversación archivada." });
    if (evidenceResult.result.state === "client_not_selected") return reply.code(409).send({ error: "client_not_selected", message: "Selecciona un cliente antes de preguntar al asistente." });
    if (evidenceResult.result.state !== "ready") return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
    const authorizedEvidence = evidenceResult.result;

    // Recheck the session, scope, and active client immediately before sending
    // data to the external provider; use evidence from this fresh read.
    const preflightResult = await readAuthorizedEvidence();
    if (!preflightResult.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Tu sesión venció. Inicia sesión para continuar." });
    if (!preflightResult.authorized || preflightResult.result.state === "not_found") return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
    if (preflightResult.result.state === "archived") return reply.code(409).send({ error: "conversation_archived", message: "No se pueden agregar mensajes a una conversación archivada." });
    if (preflightResult.result.state === "client_not_selected") return reply.code(409).send({ error: "client_not_selected", message: "Selecciona un cliente antes de preguntar al asistente." });
    if (preflightResult.result.state !== "ready") return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
    if (preflightResult.result.client.document_path !== authorizedEvidence.client.document_path || preflightResult.result.client.id !== authorizedEvidence.client.id)
      return reply.code(409).send({ error: "context_changed", message: "El cliente activo cambió durante la consulta. Vuelve a enviar la pregunta para el cliente seleccionado." });
    const freshAuthorizedEvidence = preflightResult.result;

    let answer: string;
    try {
      answer = await assistantService.draft(freshAuthorizedEvidence, content);
    } catch {
      return reply.code(502).send({ error: "assistant_provider_error", message: "El proveedor de redacción no respondió correctamente. No se generó ni guardó una respuesta; inténtalo de nuevo." });
    }
    const saveResult = await withAuthorizedConversationTransaction(
      pool, digest(tokenOf(req)), req.params.conversationId,
      async (client, conversation) => {
        if (conversation.status !== "active") return { state: "archived" as const };
        if (conversation.active_client_path !== freshAuthorizedEvidence.client.document_path || conversation.active_client_record_id !== freshAuthorizedEvidence.client.id) return { state: "context_changed" as const };
        const userMessage = await client.query(
          `INSERT INTO reto.chat_messages(
             conversation_id, sender_role, content,
             client_document_path, client_record_id
           )
           VALUES ($1, 'user', $2, $3, $4)
           RETURNING id, sequence_no, sender_role, content, created_at`,
          [conversation.id, content, freshAuthorizedEvidence.client.document_path, freshAuthorizedEvidence.client.id],
        );
        const assistantMessage = await client.query(
          `INSERT INTO reto.chat_messages(
             conversation_id, sender_role, content,
             client_document_path, client_record_id
           )
           VALUES ($1, 'assistant', $2, $3, $4)
           RETURNING id, sequence_no, sender_role, content, created_at`,
          [conversation.id, answer, freshAuthorizedEvidence.client.document_path, freshAuthorizedEvidence.client.id],
        );
        await client.query("UPDATE reto.chat_conversations SET updated_at = now() WHERE id = $1", [conversation.id]);
        return { state: "saved" as const, messages: [userMessage.rows[0], assistantMessage.rows[0]] };
      },
    );
    if (!saveResult.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Tu sesión venció. Inicia sesión para continuar." });
    if (!saveResult.authorized) return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
    if (saveResult.result.state === "context_changed") return reply.code(409).send({ error: "context_changed", message: "El cliente activo cambió durante la consulta. Vuelve a enviar la pregunta para el cliente seleccionado." });
    if (saveResult.result.state === "archived") return reply.code(409).send({ error: "conversation_archived", message: "No se pueden agregar mensajes a una conversación archivada." });
    return reply.code(201).send({ messages: saveResult.result.messages });
  },
);

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
app.post<{
  Params: { conversationId: string };
  Body: {
    content: string;
    kind: "request_details" | "invalid_details" | "review" | "repeat_confirmation" | "created" | "conflict" | "cancelled" | "appointments_list";
    expectedClientPath: string;
    expectedClientRecordId: string;
    confirmationId?: string;
    appointmentId?: string;
  };
}>(
  "/api/conversations/:conversationId/appointment-chat",
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
        required: ["content", "kind", "expectedClientPath", "expectedClientRecordId"],
        properties: {
          content: { type: "string", minLength: 1, maxLength: 4000 },
          kind: { type: "string", enum: ["request_details", "invalid_details", "review", "repeat_confirmation", "created", "conflict", "cancelled", "appointments_list"] },
          expectedClientPath: { type: "string", minLength: 1, maxLength: 1000 },
          expectedClientRecordId: { type: "string", minLength: 1, maxLength: 200 },
          confirmationId: { type: "string", format: "uuid" },
          appointmentId: { type: "string", format: "uuid" },
        },
      },
    },
  },
  async (req, reply) => {
    const content = req.body.content.trim();
    if (!content)
      return reply.code(400).send({ error: "invalid_request", message: "El mensaje no puede estar vacío." });
    const needsConfirmation = req.body.kind === "review" || req.body.kind === "repeat_confirmation";
    if (needsConfirmation !== (req.body.confirmationId !== undefined) ||
        (req.body.kind === "created") !== (req.body.appointmentId !== undefined))
      return reply.code(400).send({ error: "invalid_request", message: "Faltan datos para responder en el chat de citas." });

    const result = await withAuthorizedConversationTransaction(
      pool, digest(tokenOf(req)), req.params.conversationId,
      async (client, conversation, principal) => {
        if (conversation.status !== "active") return { state: "archived" as const };
        if (principal.role !== "agent" && req.body.kind !== "appointments_list") return { state: "agent_only" as const };
        if (!conversation.active_client_path || !conversation.active_client_record_id)
          return { state: "client_not_selected" as const };
        if (conversation.active_client_path !== req.body.expectedClientPath ||
            conversation.active_client_record_id !== req.body.expectedClientRecordId)
          return { state: "context_changed" as const };
        const profile = await getAuthorizedClientProfile(client, principal, conversation.active_client_path, conversation.active_client_record_id);
        if (!profile) return { state: "client_not_found" as const };
        const { rows: agentRows } = await client.query(
          `SELECT NULLIF(trim(concat_ws(' ', first_name, middle_name, last_name)), '') AS name
             FROM onboarding.profiles WHERE account_id = $1`,
          [principal.accountId],
        );
        const agentName = agentRows[0]?.name || "Agente conectado";
        let response = "No pude completar la solicitud de cita.";

        if (req.body.kind === "request_details") {
          response = "Claro. Indícame la fecha y hora local como AAAA-MM-DD HH:mm o DD/MM/AAAA HH:mm; por ejemplo, 2026-10-25 15:00 o 25/10/2026 15:00. Usaré America/Bogota y una duración de 30 minutos por defecto; puedes indicar otra duración en minutos. Antes de guardar te mostraré los datos para que los confirmes.";
        } else if (req.body.kind === "invalid_details") {
          response = "No pude validar esos datos. Envíame una fecha válida como AAAA-MM-DD HH:mm o DD/MM/AAAA HH:mm. Puedes añadir la duración en minutos. Todavía no se guardó ninguna cita.";
        } else if (req.body.kind === "cancelled") {
          response = "De acuerdo, cancelé la solicitud. No se guardó ninguna cita.";
        } else if (req.body.kind === "conflict") {
          const { rows } = await client.query(
            `SELECT 1 FROM reto.chat_actions
              WHERE conversation_id = $1 AND actor_account_id = $2
                AND action_type = 'appointment.created'
                AND outcome = 'conflict' AND error_code = 'slot_taken'
                AND occurred_at >= now() - interval '5 minutes'
              LIMIT 1`,
            [conversation.id, principal.accountId],
          );
          if (!rows.length) return { state: "conflict_not_found" as const };
          response = "Ese horario se cruzó con otra cita y no se guardó. Envíame otra fecha y hora para preparar una nueva confirmación.";
        } else if (needsConfirmation) {
          const { rows } = await client.query(
            `SELECT action, agent_account_id, local_start, time_zone,
                    start_utc_offset_minutes,
                    extract(epoch FROM (end_at - start_at))::int / 60 AS duration_minutes
               FROM reto.chat_appointment_confirmations
              WHERE id = $1 AND conversation_id = $2
                AND requested_by_account_id = $3
                AND client_document_path = $4 AND client_record_id = $5
                AND status = 'pending' AND expires_at > now()`,
            [req.body.confirmationId, conversation.id, principal.accountId, conversation.active_client_path, conversation.active_client_record_id],
          );
          const confirmation = rows[0];
          if (!confirmation || confirmation.action !== "create" ||
              !(await isAuthorizedAppointmentAgent(client, principal, confirmation.agent_account_id)))
            return { state: "confirmation_not_found" as const };
          response = `Confirma la creación de esta cita:\nCliente: ${profile.name || "Cliente activo"}\nAgente: ${agentName}\nFecha y hora: ${String(confirmation.local_start).replace("T", " ")}\nDuración: ${confirmation.duration_minutes} minutos\nZona horaria: ${confirmation.time_zone}\n\nResponde “Confirmar” para guardarla o “Cancelar” para descartarla.`;
        } else if (req.body.kind === "created") {
          const { rows } = await client.query(
            `SELECT a.local_start, a.time_zone, a.agent_account_id,
                    extract(epoch FROM (a.end_at - a.start_at))::int / 60 AS duration_minutes
               FROM reto.chat_appointments AS a
               JOIN reto.chat_actions AS action
                 ON action.conversation_id = a.conversation_id
                AND action.actor_account_id = $4
                AND action.action_type = 'appointment.created'
                AND action.outcome = 'succeeded'
                AND action.entity_id = a.id::text
              WHERE a.id = $1 AND a.conversation_id = $2
                AND a.client_document_path = $3 AND a.client_record_id = $5
                AND a.status = 'confirmed'
              ORDER BY action.occurred_at DESC LIMIT 1`,
            [req.body.appointmentId, conversation.id, conversation.active_client_path, principal.accountId, conversation.active_client_record_id],
          );
          const appointment = rows[0];
          if (!appointment || !(await isAuthorizedAppointmentAgent(client, principal, appointment.agent_account_id)))
            return { state: "appointment_not_found" as const };
          response = `La cita quedó guardada en la agenda.\nCliente: ${profile.name || "Cliente activo"}\nAgente: ${agentName}\nFecha y hora: ${String(appointment.local_start).replace("T", " ")}\nDuración: ${appointment.duration_minutes} minutos\nZona horaria: ${appointment.time_zone}.`;
        } else if (req.body.kind === "appointments_list") {
          const { rows } = await client.query(
            `SELECT id, agent_account_id, local_start, time_zone,
                    extract(epoch FROM (end_at - start_at))::int / 60 AS duration_minutes
               FROM reto.chat_appointments
              WHERE client_document_path = $1
                AND client_record_id = $2
                AND status = 'confirmed'
              ORDER BY start_at, id`,
            [conversation.active_client_path, conversation.active_client_record_id],
          );
          const appointments = [];
          for (const appointment of rows) {
            if (await isAuthorizedAppointmentAgent(client, principal, appointment.agent_account_id))
              appointments.push(appointment);
          }
          response = appointments.length
            ? `Estas son las citas confirmadas del cliente activo:\n${appointments.map((appointment: { local_start: string; duration_minutes: number; time_zone: string }) => `• ${String(appointment.local_start).replace("T", " ")} · ${appointment.duration_minutes} minutos · ${appointment.time_zone}`).join("\n")}`
            : "No hay citas confirmadas para el cliente activo.";
        }

        if (req.body.kind === "request_details" || req.body.kind === "invalid_details" || req.body.kind === "conflict") {
          await client.query(
            `INSERT INTO reto.chat_appointment_chat_state(
               conversation_id, requested_by_account_id, client_document_path,
               client_record_id, stage, confirmation_id, updated_at
             ) VALUES ($1, $2, $3, $4, 'details', NULL, now())
             ON CONFLICT (conversation_id) DO UPDATE SET
               requested_by_account_id = excluded.requested_by_account_id,
               client_document_path = excluded.client_document_path,
               client_record_id = excluded.client_record_id,
               stage = 'details', confirmation_id = NULL, updated_at = now()`,
            [conversation.id, principal.accountId, conversation.active_client_path, conversation.active_client_record_id],
          );
        } else if (req.body.kind === "review" || req.body.kind === "repeat_confirmation") {
          await client.query(
            `INSERT INTO reto.chat_appointment_chat_state(
               conversation_id, requested_by_account_id, client_document_path,
               client_record_id, stage, confirmation_id, updated_at
             ) VALUES ($1, $2, $3, $4, 'confirmation', $5, now())
             ON CONFLICT (conversation_id) DO UPDATE SET
               requested_by_account_id = excluded.requested_by_account_id,
               client_document_path = excluded.client_document_path,
               client_record_id = excluded.client_record_id,
               stage = 'confirmation', confirmation_id = excluded.confirmation_id,
               updated_at = now()`,
            [conversation.id, principal.accountId, conversation.active_client_path, conversation.active_client_record_id, req.body.confirmationId],
          );
        } else if (req.body.kind === "cancelled" || req.body.kind === "created") {
          await client.query(
            `DELETE FROM reto.chat_appointment_chat_state
              WHERE conversation_id = $1 AND requested_by_account_id = $2`,
            [conversation.id, principal.accountId],
          );
        }

        const userMessage = await client.query(
          `INSERT INTO reto.chat_messages(conversation_id, sender_role, content, client_document_path, client_record_id)
           VALUES ($1, 'user', $2, $3, $4)
           RETURNING id, sequence_no, sender_role, content, created_at`,
          [conversation.id, content, conversation.active_client_path, conversation.active_client_record_id],
        );
        const assistantMessage = await client.query(
          `INSERT INTO reto.chat_messages(conversation_id, sender_role, content, client_document_path, client_record_id)
          VALUES ($1, 'assistant', $2, $3, $4)
           RETURNING id, sequence_no, sender_role, content, created_at`,
          [conversation.id, response, conversation.active_client_path, conversation.active_client_record_id],
        );
        await client.query("UPDATE reto.chat_conversations SET updated_at = now() WHERE id = $1", [conversation.id]);
        return { state: "saved" as const, messages: [userMessage.rows[0], assistantMessage.rows[0]] };
      },
    );
    if (!result.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
    if (!result.authorized) return reply.code(404).send({ error: "not_found", message: "Conversación no encontrada." });
    if (result.result.state === "archived") return reply.code(409).send({ error: "conversation_archived", message: "No se puede agendar en una conversación archivada." });
    if (result.result.state === "agent_only") return reply.code(403).send({ error: "forbidden", message: "La agenda por chat está disponible para agentes." });
    if (result.result.state === "client_not_selected") return reply.code(409).send({ error: "client_not_selected", message: "Selecciona un cliente antes de crear una cita." });
    if (result.result.state === "client_not_found" || result.result.state === "confirmation_not_found" || result.result.state === "appointment_not_found" || result.result.state === "conflict_not_found")
      return reply.code(404).send({ error: "not_found", message: "No se encontró el cliente o la confirmación vigente." });
    if (result.result.state === "context_changed")
      return reply.code(409).send({ error: "context_changed", message: "Cambió el cliente activo. Vuelve a iniciar la solicitud de cita." });
    return reply.code(201).send({ messages: result.result.messages });
  },
);
const dummyHash = await hashPassword(randomBytes(24).toString("hex"));
app.post<{ Body: { usuario: string; contrasena: string } }>(
  "/auth/get-toke",
  {
    config: { rateLimit: { max: 15, timeWindow: "1 minute" } },
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["usuario", "contrasena"],
        properties: {
          usuario: { type: "string", minLength: 1, maxLength: 254 },
          contrasena: { type: "string", minLength: 1, maxLength: 256 },
        },
      },
    },
  },
  async (req, reply) => {
    const user = req.body.usuario.trim().toLowerCase();
    const found = await pool.query(
      "SELECT a.id,a.password_hash FROM reto.agents a JOIN onboarding.accounts account ON account.id=a.id WHERE (a.username=$1 OR a.email=$1) AND account.status='active' AND account.role IN ('agent','agency_owner','admin')",
      [user],
    );
    const account = found.rows[0];
    if (
      !(await checkPassword(
        req.body.contrasena,
        account?.password_hash || dummyHash,
      )) ||
      !account
    )
      return reply.code(401).send({
        error: "invalid_credentials",
        message: "Usuario o contraseña incorrectos.",
      });
    const token = randomBytes(32).toString("base64url");
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      await conn.query(
        "SELECT id FROM onboarding.accounts WHERE id=$1 FOR UPDATE",
        [account.id],
      );
      await conn.query("DELETE FROM reto.sessions WHERE agent_id=$1", [
        account.id,
      ]);
      await conn.query(
        "INSERT INTO reto.sessions(token_hash,agent_id,expires_at) VALUES($1,$2,now()+($3::text||' hours')::interval)",
        [digest(token), account.id, ttlHours],
      );
      await conn.query("COMMIT");
    } catch (error) {
      await conn.query("ROLLBACK");
      throw error;
    } finally {
      conn.release();
    }
    reply.setCookie("reto_session", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: allowedOrigin.startsWith("https:"),
      path: "/",
      maxAge: ttlHours * 3600,
    });
    return {
      token,
      token_type: "Bearer",
      expires_in: ttlHours * 3600,
      agent: await currentAgent({
        headers: { authorization: `Bearer ${token}` },
        cookies: {},
      }),
    };
  },
);
app.get("/auth/me", async (req, reply) => {
  const agent = await currentAgent(req);
  if (!agent)
    return reply.code(401).send({
      error: "unauthorized",
      message: "Inicia sesión para continuar.",
    });
  return { agent };
});
app.post("/auth/logout", async (req, reply) => {
  const token = tokenOf(req);
  if (token)
    await pool.query("DELETE FROM reto.sessions WHERE token_hash=$1", [
      digest(token),
    ]);
  reply.clearCookie("reto_session", { path: "/" });
  return reply.code(204).send();
});
app.setErrorHandler((error, req, reply) => {
  const problem = error as {
    validation?: unknown;
    statusCode?: number;
    code?: string;
  };
  if (problem.validation)
    return reply.code(400).send({
      error: "invalid_request",
      message: "Revisa los datos enviados.",
    });
  if (problem.statusCode === 429)
    return reply.code(429).send({
      error: "too_many_requests",
      message: "Demasiados intentos. Espera un minuto.",
    });
  req.log.error({ code: (error as any).code }, "Request failed");
  return reply.code(500).send({
    error: "internal_error",
    message: "No fue posible completar la solicitud.",
  });
});
await initializeDatabase();
const stop = async () => {
  await app.close();
  await pool.end();
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
await app.listen({ port: Number(process.env.PORT || 8000), host: "0.0.0.0" });
