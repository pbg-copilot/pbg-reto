import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import type { AppointmentConfirmationBody } from "../domain/appointment-confirmation.js";
import { createAppointmentConfirmationService } from "../appointment-confirmation-composition.js";
import { appointmentConfirmationResponse } from "../presentation/appointment-confirmation-response.js";

export function registerAppointmentConfirmationRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies) {
  const confirmation = createAppointmentConfirmationService(pool);
  app.post<{
    Params: { conversationId: string };
    Body: AppointmentConfirmationBody;
  }>(
    "/api/conversations/:conversationId/appointments/confirm",
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
          required: ["action"],
          properties: {
            action: { type: "string", enum: ["create", "reschedule", "cancel"] },
            appointmentId: { type: "string", format: "uuid" },
            agentAccountId: { type: "string", minLength: 1, maxLength: 200 },
            localStart: {
              type: "string",
              pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2})?$",
            },
            durationMinutes: { type: "integer", minimum: 1, maximum: 1440 },
            timeZone: {
              type: "string",
              minLength: 3,
              maxLength: 100,
              pattern: "^(UTC|[A-Za-z_]+/[A-Za-z0-9_+.-]+(?:/[A-Za-z0-9_+.-]+)*)$",
            },
            utcOffsetMinutes: { type: "integer", minimum: -840, maximum: 840 },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await confirmation.prepare({
        tokenHash: digest(tokenOf(req)), conversationId: req.params.conversationId, body: req.body,
      });
      const response = appointmentConfirmationResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
}
