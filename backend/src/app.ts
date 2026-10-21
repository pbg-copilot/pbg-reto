import Fastify, { type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Env } from "./config/env.js";
import type { Database } from "./db/kysely.js";
import errorsPlugin from "./plugins/errors.js";
import securityPlugin from "./plugins/security.js";
import authPlugin from "./plugins/auth.js";
import idempotencyPlugin from "./plugins/idempotency.js";
import swaggerPlugin from "./plugins/swagger.js";
import healthRoutes from "./modules/health/routes.js";
import authRoutes from "./modules/auth/routes.js";
import ticketRoutes from "./modules/tickets/routes.js";
import catalogRoutes from "./modules/tickets/catalog-routes.js";
import { createTicketService } from "./modules/tickets/service.js";
import articleRoutes from "./modules/articles/routes.js";
import { createArticleService } from "./modules/articles/service.js";
import conversationRoutes from "./modules/conversations/routes.js";
import { createConversationService } from "./modules/conversations/service.js";
import { createProvider } from "./modules/assistant/index.js";
import type { AssistantProvider } from "./modules/assistant/provider.js";

export type BuildAppOptions = {
  env: Env;
  db: Database;
  logger?: FastifyServerOptions["logger"];
  // Los tests inyectan un proveedor (por ejemplo, el fake o uno que siempre falla).
  provider?: AssistantProvider;
};

declare module "fastify" {
  interface FastifyInstance {
    config: Env;
    db: Database;
  }
}

// Factory de la API. Los tests la usan con app.inject() sin levantar puertos.
export async function buildApp({ env, db, logger = false, provider }: BuildAppOptions) {
  const app = Fastify({ logger, bodyLimit: 16384 }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("config", env);
  app.decorate("db", db);

  await app.register(errorsPlugin);
  await app.register(securityPlugin, { allowedOrigins: env.APP_ORIGIN });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin);
  await app.register(idempotencyPlugin, { db });
  await app.register(swaggerPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes, {
    ttlHours: env.SESSION_TTL_HOURS,
    secureCookie: env.PUBLIC_APP_URL.startsWith("https:"),
  });
  await app.register(catalogRoutes);
  const tickets = createTicketService(db);
  await app.register(ticketRoutes, { service: tickets });
  await app.register(articleRoutes, { service: createArticleService(db) });
  await app.register(conversationRoutes, {
    service: createConversationService({ db, env, tickets, provider: provider ?? createProvider(env) }),
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
