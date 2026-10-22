import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { createAppointmentChatStateService } from "../appointment-chat-state-composition.js";
import { appointmentChatStateResponse } from "../presentation/appointment-chat-state-response.js";

export function registerAppointmentChatStateRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies): void {
  const chatState = createAppointmentChatStateService(pool);
  app.get<{ Params: { conversationId: string } }>(
    "/api/conversations/:conversationId/appointment-chat/state",
    {
      schema: {
        params: {
          type: "object", additionalProperties: false, required: ["conversationId"],
          properties: { conversationId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const result = await chatState.load(digest(tokenOf(req)), req.params.conversationId);
      const response = appointmentChatStateResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
}
