import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "./route-dependencies.js";
import { searchAuthorizedClients } from "./authorization.js";

export function registerClientSearchRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies): void {
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
}
