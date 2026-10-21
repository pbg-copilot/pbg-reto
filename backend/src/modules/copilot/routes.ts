import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyRequest } from "fastify";
import { apiErrorSchema, copilotDraftSchema, copilotSummarySchema, similarTicketsSchema } from "@reto/shared";
import { digest, tokenOf } from "../auth/session.js";
import type { CopilotService } from "./service.js";

const idParams = z.object({ id: z.uuid() });
const security: Record<string, string[]>[] = [{ bearer: [] }, { cookie: [] }];
const errors = { 401: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema, 429: apiErrorSchema, 503: apiErrorSchema };
// 10 llamadas al modelo por minuto y por admin (sesión).
const copilotRateLimit = {
  max: 10,
  timeWindow: "1 minute",
  keyGenerator: (request: FastifyRequest) => {
    const token = tokenOf(request);
    return token ? `copilot:${digest(token)}` : `copilot-ip:${request.ip}`;
  },
};

const copilotRoutes: FastifyPluginAsyncZod<{ service: CopilotService }> = async (app, { service }) => {
  const tags = ["copiloto"];
  const admin = { preValidation: app.requireAdmin };

  app.post(
    "/tickets/:id/copilot/summary",
    {
      ...admin,
      config: { rateLimit: copilotRateLimit },
      schema: {
        tags,
        security,
        summary: "Resumir el caso (solo admin)",
        description: "Usa el ticket completo, incluidas las notas internas. Es un borrador interno: el admin decide si lo guarda como nota.",
        params: idParams,
        response: { 200: copilotSummarySchema, ...errors },
      },
    },
    async (request) => service.summary(request.actor!, request.params.id),
  );

  app.post(
    "/tickets/:id/copilot/reply-draft",
    {
      ...admin,
      config: { rateLimit: copilotRateLimit },
      schema: {
        tags,
        security,
        summary: "Sugerir una respuesta pública (solo admin)",
        description:
          "El contexto se arma con la vista del solicitante: sin notas internas ni adjuntos internos. Devuelve un borrador que el admin edita y envía; nunca se envía solo.",
        params: idParams,
        response: { 200: copilotDraftSchema, ...errors },
      },
    },
    async (request) => service.replyDraft(request.actor!, request.params.id),
  );

  app.get(
    "/tickets/:id/similar",
    {
      ...admin,
      schema: {
        tags,
        security,
        summary: "Posibles duplicados (solo admin)",
        description: "Hasta 5 tickets no cerrados de los últimos 30 días con título o descripción parecidos (pg_trgm). Sin IA.",
        params: idParams,
        response: { 200: similarTicketsSchema, ...errors },
      },
    },
    async (request) => service.similar(request.actor!, request.params.id),
  );
};

export default copilotRoutes;
