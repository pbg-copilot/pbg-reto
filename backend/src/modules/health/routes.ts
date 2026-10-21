import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { pool } from "../../db.js";

const healthSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  service: z.literal("reto-api"),
  database: z.enum(["ok", "unavailable"]),
});

const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["health"],
        summary: "Estado de la API y PostgreSQL",
        response: { 200: healthSchema, 503: healthSchema },
      },
    },
    async (_request, reply) => {
      try {
        await pool.query("SELECT 1");
        return { status: "ok" as const, service: "reto-api" as const, database: "ok" as const };
      } catch {
        return reply.code(503).send({
          status: "unavailable",
          service: "reto-api",
          database: "unavailable",
        });
      }
    },
  );
};

export default healthRoutes;
