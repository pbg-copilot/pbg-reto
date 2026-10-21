import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomBytes } from "node:crypto";
import { initializeDatabase, pool } from "./db.js";
import { checkPassword, hashPassword } from "./passwords.js";
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
          `SELECT id, sequence_no, sender_role, content, created_at
             FROM reto.chat_messages
            WHERE conversation_id = $1
              AND client_document_path IS NULL
              AND client_record_id IS NULL
              AND evidence_refs = '[]'::jsonb
              AND ($2::bigint IS NULL OR sequence_no < $2::bigint)
            ORDER BY sequence_no DESC
            LIMIT $3`,
          [conversation.id, beforeSequence, limit + 1],
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
          `INSERT INTO reto.chat_messages(conversation_id, sender_role, content)
           VALUES($1, 'user', $2)
           RETURNING id, sequence_no, sender_role, content, created_at`,
          [conversation.id, content],
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
