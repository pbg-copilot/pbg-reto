import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import type { AppointmentExecution } from "../domain/appointment-execution.js";
import { appointmentExecutionResponse } from "../presentation/appointment-execution-response.js";

export type AppointmentExecutionRouteDependencies = Pick<RouteDependencies, "digest" | "tokenOf"> & {
  appointmentExecution: AppointmentExecution;
};

export function registerAppointmentExecutionRoutes(
  app: FastifyInstance,
  { appointmentExecution, digest, tokenOf }: AppointmentExecutionRouteDependencies,
) {
  app.post<{
    Params: { conversationId: string };
    Body: { confirmationId: string; idempotencyKey: string };
  }>(
    "/api/conversations/:conversationId/appointments",
    {
      schema: {
        params: {
          type: "object", additionalProperties: false, required: ["conversationId"],
          properties: { conversationId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object", additionalProperties: false, required: ["confirmationId", "idempotencyKey"],
          properties: {
            confirmationId: { type: "string", format: "uuid" },
            idempotencyKey: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await appointmentExecution.execute({
        tokenHash: digest(tokenOf(req)), conversationId: req.params.conversationId,
        confirmationId: req.body.confirmationId, idempotencyKey: req.body.idempotencyKey,
      });
      const response = appointmentExecutionResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
}
