import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { createConversationManagementService } from "../conversation-management-composition.js";
import { createConversationResponse, renameConversationResponse, conversationHistoryResponse } from "../presentation/conversation-management-response.js";

export function registerConversationManagementRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies): void {
  const service = createConversationManagementService(pool);
  app.get<{
    Querystring: { search?: string };
  }>("/api/conversations", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        properties: {
          search: { type: "string", minLength: 1, maxLength: 120 },
        },
      },
    },
  }, async (req, reply) => {
    const principal = req.principal;
    if (!principal)
      return reply.code(401).send({
        error: "unauthorized",
        message: "Inicia sesión para continuar.",
      });
    return { conversations: await service.list(principal, req.query.search) };
  });
  app.post<{ Body: { title?: string } }>(
    "/api/conversations",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await service.create(digest(tokenOf(req)), req.body.title);
      const response = createConversationResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
  app.patch<{
    Params: { conversationId: string };
    Body: { title: string };
  }>(
    "/api/conversations/:conversationId",
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
          required: ["title"],
          properties: { title: { type: "string", minLength: 1, maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const result = await service.rename(digest(tokenOf(req)), req.params.conversationId, req.body.title);
      const response = renameConversationResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
  app.get<{
    Params: { conversationId: string };
    Querystring: { limit?: number; beforeSequence?: string };
  }>(
    "/api/conversations/:conversationId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string", format: "uuid" },
          },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            beforeSequence: {
              type: "string",
              pattern: "^[1-9][0-9]{0,18}$",
            },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await service.history(
        digest(tokenOf(req)), req.params.conversationId, req.query.limit ?? 50, req.query.beforeSequence ?? null,
      );
      const response = conversationHistoryResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
}
