import type { FastifyInstance } from "fastify";
import type { AssistantConfig } from "../config/assistant-config.js";
import type { AssistantConversationPort } from "../services/assistant-conversation-ports.js";
import { createAssistantConversationService } from "../assistant-conversation-composition.js";
import { assistantConversationResponse } from "../presentation/assistant-conversation-response.js";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";

type AssistantRouteDependencies = RouteDependencies & {
  assistantConfig: AssistantConfig;
  assistantService: AssistantConversationPort;
};

export function registerAssistantRoutes(
  app: FastifyInstance,
  { pool, digest, tokenOf, assistantConfig, assistantService }: AssistantRouteDependencies,
): void {
  const conversations = createAssistantConversationService(pool, assistantService);

  app.get("/api/assistant/status", async () => ({
    enabled: assistantService.isEnabled(),
    provider: assistantConfig.provider,
    model: assistantService.isEnabled() ? assistantConfig.model : null,
    externalDataAuthorized: assistantConfig.externalDataAuthorized,
  }));
  app.post<{
    Params: { conversationId: string };
    Body: { content: string };
  }>(
    "/api/conversations/:conversationId/assistant",
    {
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        params: { type: "object", additionalProperties: false, required: ["conversationId"], properties: { conversationId: { type: "string", format: "uuid" } } },
        body: { type: "object", additionalProperties: false, required: ["content"], properties: { content: { type: "string", minLength: 1, maxLength: 4000 } } },
      },
    },
    async (req, reply) => {
      const result = await conversations.respond(digest(tokenOf(req)), req.params.conversationId, req.body.content);
      const response = assistantConversationResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
}
