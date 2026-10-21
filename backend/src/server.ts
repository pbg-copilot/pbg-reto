import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { initializeDatabase, pool } from "./db.js";
import { checkPassword, hashPassword } from "./passwords.js";
import { LocalDateTimeError, resolveLocalDateTime } from "./timezones.js";
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
type AppointmentAction = "create" | "reschedule" | "cancel";
type AppointmentRow = Record<string, any>;
function appointmentTargetFingerprint(row: AppointmentRow): string {
  const snapshot = {
    id: row.id,
    conversation_id: row.conversation_id,
    client_document_path: row.client_document_path,
    client_record_id: row.client_record_id,
    agent_account_id: row.agent_account_id,
    start_at: new Date(row.start_at).toISOString(),
    end_at: new Date(row.end_at).toISOString(),
    time_zone: row.time_zone,
    local_start: String(row.local_start),
    start_utc_offset_minutes: Number(row.start_utc_offset_minutes),
    status: row.status,
    last_confirmation_id: row.last_confirmation_id,
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function publicAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    client_document_path: row.client_document_path,
    client_record_id: row.client_record_id,
    agent_account_id: row.agent_account_id,
    start_at: new Date(row.start_at).toISOString(),
    end_at: new Date(row.end_at).toISOString(),
    time_zone: row.time_zone,
    local_start: String(row.local_start),
    start_utc_offset_minutes: Number(row.start_utc_offset_minutes),
    status: row.status,
  };
}

async function isAuthorizedAppointmentAgent(
  client: PoolClient,
  principal: Principal,
  agentAccountId: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1
       FROM onboarding.accounts
      WHERE id = $1
        AND role = 'agent'
        AND status = 'active'
        AND (
          ($2 = 'agent' AND id = $3)
          OR ($2 = 'agency_owner' AND agency_id = $4)
        )`,
    [agentAccountId, principal.role, principal.accountId, principal.agencyId],
  );
  return rows.length > 0;
}

async function recordAppointmentAction(
  client: PoolClient,
  principal: Principal,
  conversationId: string,
  actionType: string,
  entityId: string,
  outcome: "succeeded" | "rejected" | "conflict" | "failed",
  errorCode: string | null,
  idempotencyKey: string,
  idempotencyFingerprint: string,
  resultSnapshot: object,
): Promise<void> {
  await client.query(
    `INSERT INTO reto.chat_actions(
       conversation_id, actor_account_id, actor_role, scope_agency_id,
       action_type, entity_type, entity_id, outcome, error_code,
       idempotency_key, idempotency_fingerprint, result_snapshot
     ) VALUES($1, $2, $3, $4, $5, 'appointment', $6, $7, $8, $9, $10, $11::jsonb)`,
    [
      conversationId,
      principal.accountId,
      principal.role,
      principal.agencyId,
      actionType,
      entityId,
      outcome,
      errorCode,
      idempotencyKey,
      idempotencyFingerprint,
      JSON.stringify(resultSnapshot),
    ],
  );
}
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
