import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomBytes } from "node:crypto";
import { initializeDatabase, pool } from "./db.js";
import { checkPassword, hashPassword } from "./passwords.js";
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
  const { rows } = await pool.query(
    "SELECT a.id,a.username,a.email,a.name,a.role,a.agency_id,g.name AS agency_name FROM reto.sessions s JOIN reto.agents a ON a.id=s.agent_id LEFT JOIN reto.agencies g ON g.id=a.agency_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [digest(token)],
  );
  return rows[0] || null;
}
app.get("/health", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ok", service: "reto-api", database: "ok" };
  } catch {
    return reply
      .code(503)
      .send({
        status: "unavailable",
        service: "reto-api",
        database: "unavailable",
      });
  }
});
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
      "SELECT id,password_hash FROM reto.agents WHERE username=$1 OR email=$1",
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
      return reply
        .code(401)
        .send({
          error: "invalid_credentials",
          message: "Usuario o contraseña incorrectos.",
        });
    const token = randomBytes(32).toString("base64url");
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      await conn.query("SELECT id FROM reto.agents WHERE id=$1 FOR UPDATE", [
        account.id,
      ]);
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
    return reply
      .code(401)
      .send({
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
    return reply
      .code(400)
      .send({
        error: "invalid_request",
        message: "Revisa los datos enviados.",
      });
  if (problem.statusCode === 429)
    return reply
      .code(429)
      .send({
        error: "too_many_requests",
        message: "Demasiados intentos. Espera un minuto.",
      });
  req.log.error({ code: (error as any).code }, "Request failed");
  return reply
    .code(500)
    .send({
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
