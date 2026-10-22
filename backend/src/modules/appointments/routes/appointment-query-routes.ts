import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { createAppointmentQueryService } from "../appointment-query-composition.js";
import { appointmentQueryResponse } from "../presentation/appointment-query-response.js";

export function registerAppointmentQueryRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies) {
  const appointments = createAppointmentQueryService(pool);
  app.get<{ Params: { conversationId: string } }>(
    "/api/conversations/:conversationId/appointments",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId"],
          properties: { conversationId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const result = await appointments.list(
        digest(tokenOf(req)),
        req.params.conversationId,
      );
      const response = appointmentQueryResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
}
