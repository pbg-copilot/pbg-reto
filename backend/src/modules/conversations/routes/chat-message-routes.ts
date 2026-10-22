import type { FastifyInstance } from "fastify";
import { createChatMessageService } from "../chat-message-composition.js";
import { chatMessageResponse } from "../presentation/chat-message-response.js";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";

export function registerChatMessageRoutes(
  app: FastifyInstance,
  { pool, digest, tokenOf }: RouteDependencies,
): void {
  const messages = createChatMessageService(pool);
  app.post<{
    Params: { conversationId: string };
    Body: { content: string };
  }>(
    "/api/conversations/:conversationId/messages",
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
        body: {
          type: "object",
          additionalProperties: false,
          required: ["content"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 12000 },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await messages.create(
        digest(tokenOf(req)),
        req.params.conversationId,
        req.body.content,
      );
      const response = chatMessageResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
}
