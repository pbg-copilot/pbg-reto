import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { createHash } from "node:crypto";
import { initializeDatabase, pool } from "./db.js";
import { loadAssistantConfig } from "./assistant-config.js";
import { OpenAiCompatibleAssistantProvider } from "./assistant-provider.js";
import { PostgresAssistantEvidenceRepository } from "./assistant-evidence-repository.js";
import { AssistantService } from "./assistant-service.js";
import { registerAppointmentChatRoutes } from "./appointment-chat-routes.js";
import { registerAppointmentRoutes } from "./appointment-routes.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerAssistantRoutes } from "./assistant-routes.js";
import { registerChatMessageRoutes } from "./chat-message-routes.js";
import { registerClientContextRoutes } from "./client-context-routes.js";
import { registerConversationRoutes } from "./conversation-routes.js";
import { registerFollowUpRoutes } from "./follow-up-routes.js";
import { resolvePrincipal } from "./authorization.js";
import type { RouteDependencies } from "./route-dependencies.js";

const app = Fastify({
  logger: { level: "info", redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"] },
  bodyLimit: 16384,
});
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
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenOf: RouteDependencies["tokenOf"] = (req) => {
  if (req.headers.authorization)
    return /^Bearer [A-Za-z0-9_-]{43}$/.test(req.headers.authorization)
      ? req.headers.authorization.slice(7)
      : "";
  return req.cookies.reto_session || "";
};

app.addHook("onRequest", async (req, reply) => {
  reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
  if (req.headers.origin && req.headers.origin !== allowedOrigin)
    return reply.code(403).send({ error: "origin_not_allowed", message: "Origen no permitido." });
});
const publicRoutes = new Set(["/health", "/auth/get-toke", "/auth/logout"]);
app.addHook("preHandler", async (req, reply) => {
  const routePath = req.routeOptions.url;
  if (routePath && publicRoutes.has(routePath)) return;
  const token = tokenOf(req);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
  req.principal = await resolvePrincipal(pool, digest(token));
  if (!req.principal)
    return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
});
app.get("/health", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    return { status: "ok", service: "reto-api", database: "ok" };
  } catch {
    return reply.code(503).send({ status: "unavailable", service: "reto-api", database: "unavailable" });
  }
});

const routeDependencies: RouteDependencies = { pool, digest, tokenOf };
registerConversationRoutes(app, routeDependencies);
registerFollowUpRoutes(app, routeDependencies);
registerClientContextRoutes(app, routeDependencies);
registerAppointmentRoutes(app, routeDependencies);
registerAssistantRoutes(app, { ...routeDependencies, assistantConfig, assistantService });
registerChatMessageRoutes(app, routeDependencies);
registerAppointmentChatRoutes(app, routeDependencies);
await registerAuthRoutes(app, { ...routeDependencies, ttlHours, allowedOrigin });

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
