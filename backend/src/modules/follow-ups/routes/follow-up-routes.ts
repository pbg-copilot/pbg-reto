import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import type { CreateFollowUpInput, FollowUpExpectedClient } from "../domain/follow-up-model.js";
import { createFollowUpService } from "../follow-up-composition.js";
import { listFollowUpsResponse, createFollowUpResponse, completeFollowUpResponse } from "../presentation/follow-up-response.js";

export function registerFollowUpRoutes(
  app: FastifyInstance,
  { pool, digest, tokenOf }: RouteDependencies,
): void {
  const service = createFollowUpService(pool);
  app.get<{ Params: { conversationId: string } }>(
    "/api/conversations/:conversationId/follow-ups",
    {
      schema: {
        params: {
          type: "object", additionalProperties: false, required: ["conversationId"],
          properties: { conversationId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req, reply) => {
      const result = await service.list(digest(tokenOf(req)), req.params.conversationId);
      const response = listFollowUpsResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );

  app.post<{
    Params: { conversationId: string };
    Body: CreateFollowUpInput;
  }>(
    "/api/conversations/:conversationId/follow-ups",
    {
      schema: {
        params: {
          type: "object", additionalProperties: false, required: ["conversationId"],
          properties: { conversationId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object", additionalProperties: false, required: ["description", "dueDate", "expectedClientPath", "expectedClientRecordId"],
          properties: {
            description: { type: "string", minLength: 1, maxLength: 500 },
            dueDate: { type: "string", format: "date" },
            expectedClientPath: { type: "string", minLength: 1, maxLength: 512, pattern: "^leads-store/books/[^\\s]+$" },
            expectedClientRecordId: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await service.create(digest(tokenOf(req)), req.params.conversationId, req.body);
      const response = createFollowUpResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );

  app.patch<{
    Params: { conversationId: string; followUpId: string };
    Body: FollowUpExpectedClient;
  }>(
    "/api/conversations/:conversationId/follow-ups/:followUpId/complete",
    {
      schema: {
        params: {
          type: "object", additionalProperties: false, required: ["conversationId", "followUpId"],
          properties: {
            conversationId: { type: "string", format: "uuid" },
            followUpId: { type: "string", format: "uuid" },
          },
        },
        body: {
          type: "object", additionalProperties: false,
          required: ["expectedClientPath", "expectedClientRecordId"],
          properties: {
            expectedClientPath: { type: "string", minLength: 1, maxLength: 512, pattern: "^leads-store/books/[^\\s]+$" },
            expectedClientRecordId: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await service.complete(digest(tokenOf(req)), req.params.conversationId, req.params.followUpId, req.body);
      const response = completeFollowUpResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
}
