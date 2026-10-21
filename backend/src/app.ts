import Fastify, { type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
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
import notificationRoutes from "./modules/notifications/routes.js";
import { createNotificationService } from "./modules/notifications/service.js";
import { createNotificationListener } from "./modules/notifications/listener.js";
import { onTicketEvent } from "./modules/tickets/events.js";
import attachmentRoutes from "./modules/attachments/routes.js";
import metricsRoutes from "./modules/metrics/routes.js";
import { createMetricsService } from "./modules/metrics/service.js";
import copilotRoutes from "./modules/copilot/routes.js";
import { createCopilotService } from "./modules/copilot/service.js";
import { createAttachmentService } from "./modules/attachments/service.js";
import { createS3Storage, type AttachmentStorage } from "./modules/attachments/storage.js";
import { createS3Client } from "./infra/s3.js";

export type BuildAppOptions = {
  env: Env;
  db: Database;
  logger?: FastifyServerOptions["logger"];
  // Los tests inyectan un proveedor (por ejemplo, el fake o uno que siempre falla).
  provider?: AssistantProvider;
  // Bucket de adjuntos; por defecto el S3 de la configuración.
  storage?: AttachmentStorage;
};

declare module "fastify" {
  interface FastifyInstance {
    config: Env;
    db: Database;
  }
}

// Factory de la API. Los tests la usan con app.inject() sin levantar puertos.
export async function buildApp({ env, db, logger = false, provider, storage }: BuildAppOptions) {
  const app = Fastify({ logger, bodyLimit: 16384 }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate("config", env);
  app.decorate("db", db);

  await app.register(errorsPlugin);
  await app.register(securityPlugin, { allowedOrigins: env.APP_ORIGIN });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  // Límites de la política de archivos (spec 006). Cada archivo se lee a memoria acotado.
  await app.register(multipart, {
    limits: { fileSize: env.UPLOAD_MAX_BYTES, files: env.UPLOAD_MAX_FILES, fields: 5, fieldSize: 200, parts: env.UPLOAD_MAX_FILES + 5 },
  });
  await app.register(authPlugin);
  await app.register(idempotencyPlugin, { db });
  await app.register(swaggerPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes, {
    ttlHours: env.SESSION_TTL_HOURS,
    secureCookie: env.PUBLIC_APP_URL.startsWith("https:"),
  });
  await app.register(catalogRoutes);
  // Las notificaciones se crean en la misma transacción de cada evento del ticket (outbox).
  const offTicketEvent = onTicketEvent(createNotificationListener({ email: env.EMAIL_NOTIFICATIONS }));
  app.addHook("onClose", async () => offTicketEvent());
  const tickets = createTicketService(db);
  await app.register(ticketRoutes, { service: tickets });
  await app.register(articleRoutes, { service: createArticleService(db) });
  const files = storage ?? createS3Storage(createS3Client(env), env.S3_BUCKET);
  // Un solo proveedor para el chat y el copiloto.
  const assistantProvider = provider ?? createProvider(env);
  await app.register(conversationRoutes, {
    service: createConversationService({ db, env, tickets, provider: assistantProvider, storage: files }),
  });
  await app.register(metricsRoutes, { service: createMetricsService(db) });
  await app.register(copilotRoutes, { service: createCopilotService({ db, env, tickets, provider: assistantProvider }) });
  await app.register(attachmentRoutes, {
    service: createAttachmentService({ db, storage: files }),
    maxBytes: env.UPLOAD_MAX_BYTES,
    maxFiles: env.UPLOAD_MAX_FILES,
  });
  await app.register(notificationRoutes, { service: createNotificationService(db) });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
