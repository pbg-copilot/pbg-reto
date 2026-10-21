import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { apiErrorSchema, metricsQuerySchema, metricsSchema, operationsSchema } from "@reto/shared";
import { exportRateLimit } from "../../lib/rate-limit.js";
import { XLSX_CONTENT_TYPE } from "../../lib/xlsx.js";
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
    async (request) => service.metrics(resolveRange(request.query.from, request.query.to), request.query.group),
  );

  app.get(
    "/support/metrics/export",
    {
      preValidation: app.requireAdmin,
      config: { rateLimit: exportRateLimit },
      schema: {
        tags: ["métricas"],
        security,
        summary: "Exportar el rango a Excel (solo admin)",
        description:
          "Devuelve un .xlsx con las hojas Resumen, Evolución, Por prioridad, Por categoría y Tickets (los creados en [from, to), hasta 20.000). Sin datos del solicitante, notas internas ni descripciones. 10 por minuto.",
        querystring: metricsQuerySchema,
        response: { 200: z.unknown().describe("Archivo .xlsx"), 400: apiErrorSchema, 401: apiErrorSchema, 403: apiErrorSchema, 429: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const range = resolveRange(request.query.from, request.query.to);
      const file = await service.exportWorkbook(range, request.query.group);
      return reply
        .header("Content-Type", XLSX_CONTENT_TYPE)
        .header("Content-Disposition", `attachment; filename="metricas-soporte-${range.from}-a-${range.to}.xlsx"`)
        .header("Cache-Control", "private, no-store")
        .send(Buffer.from(file));
    },
  );

  app.get(
    "/support/metrics/operations",
    {
      preValidation: app.requireAdmin,
      schema: {
        tags: ["métricas"],
        security,
        summary: "Estado operativo en vivo (solo admin)",
        description:
          "Qué necesita atención ahora: sin atender, esperan al equipo, esperan al solicitante (5 más antiguos y el total), antigüedad de lo pendiente, carga por admin y salud de entregas e incidentes.",
        response: { 200: operationsSchema, 401: apiErrorSchema, 403: apiErrorSchema },
      },
    },
    async () => service.operations(),
  );
};

export default metricsRoutes;
