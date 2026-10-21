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
  withAuthenticatedTransaction,
  withAuthorizedConversationTransaction,
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
