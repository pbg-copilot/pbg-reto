import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { apiErrorSchema, metricsQuerySchema, metricsSchema } from "@reto/shared";
import { resolveRange, type MetricsService } from "./service.js";

const security: Record<string, string[]>[] = [{ bearer: [] }, { cookie: [] }];

const metricsRoutes: FastifyPluginAsyncZod<{ service: MetricsService }> = async (app, { service }) => {
  app.get(
    "/support/metrics",
    {
      preValidation: app.requireAdmin,
      schema: {
        tags: ["métricas"],
        security,
        summary: "Métricas de atención (solo admin)",
        description:
          "Sobre los tickets creados en [from, to) (UTC). TPR = primer comentario público del equipo − creación; TR = último cierre como resuelto − creación. Mediana, p90 y promedio en segundos. El cumplimiento solo aparece si la prioridad tiene objetivo.",
        querystring: metricsQuerySchema,
        response: { 200: metricsSchema, 400: apiErrorSchema, 401: apiErrorSchema, 403: apiErrorSchema },
      },
    },
    async (request) => service.metrics(resolveRange(request.query.from, request.query.to)),
  );
};

export default metricsRoutes;
