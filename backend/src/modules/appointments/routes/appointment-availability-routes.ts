import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import type { AppointmentAvailabilityQuery } from "../domain/appointment-availability.js";
import { createAppointmentAvailabilityService } from "../appointment-availability-composition.js";
import { appointmentAvailabilityResponse } from "../presentation/appointment-availability-response.js";

export function registerAppointmentAvailabilityRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies) {
  const availability = createAppointmentAvailabilityService(pool);
  app.get<{
    Querystring: AppointmentAvailabilityQuery;
  }>(
    "/api/appointments/availability",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["agentAccountId", "localStart", "durationMinutes", "timeZone"],
          properties: {
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
      const result = await availability.check(digest(tokenOf(req)), req.query);
      const response = appointmentAvailabilityResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
}
