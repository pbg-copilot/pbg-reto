import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import type { AppointmentChatBody } from "../domain/appointment-chat.js";
import { createAppointmentChatService } from "../appointment-chat-composition.js";
import { appointmentChatResponse } from "../presentation/appointment-chat-response.js";

export function registerAppointmentChatRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies): void {
  const chat = createAppointmentChatService(pool);
  app.post<{
    Params: { conversationId: string };
    Body: AppointmentChatBody;
  }>(
    "/api/conversations/:conversationId/appointment-chat",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId"],
          properties: { conversationId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["content", "kind", "expectedClientPath", "expectedClientRecordId"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 4000 },
            kind: { type: "string", enum: ["request_details", "invalid_details", "review", "repeat_confirmation", "created", "conflict", "cancelled", "appointments_list"] },
            expectedClientPath: { type: "string", minLength: 1, maxLength: 1000 },
            expectedClientRecordId: { type: "string", minLength: 1, maxLength: 200 },
            confirmationId: { type: "string", format: "uuid" },
            appointmentId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await chat.send({
        tokenHash: digest(tokenOf(req)), conversationId: req.params.conversationId, body: req.body,
      });
      const response = appointmentChatResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
}
