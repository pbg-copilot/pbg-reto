import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { withAuthorizedConversationTransaction } from "../../../shared/auth/authorization.js";
import { createClientQuoteService } from "../client-quote-composition.js";
import { presentClientQuotes } from "../presentation/client-quote-presenter.js";

export function registerClientQuoteRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies): void {
  const service = createClientQuoteService();
  app.get<{ Params: { conversationId: string } }>(
    "/api/conversations/:conversationId/quotes",
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
      },
    },
    async (req, reply) => {
      const result = await withAuthorizedConversationTransaction(
        pool,
        digest(tokenOf(req)),
        req.params.conversationId,
        (client, conversation, principal) => service.load(client, conversation, principal),
      );
      if (!result.authenticated)
        return reply.code(401).send({
          error: "unauthorized",
          message: "Inicia sesión para continuar.",
        });
      if (!result.authorized)
        return reply.code(404).send({
          error: "not_found",
          message: "Conversación no encontrada.",
        });
      if (result.result.state === "not_found")
        return reply.code(404).send({
          error: "not_found",
          message: "Conversación o cliente no encontrado.",
        });
      if (result.result.state === "client_not_selected")
        return reply.code(409).send({
          error: "client_not_selected",
          message: "Selecciona un cliente antes de consultar sus cotizaciones.",
        });
      return presentClientQuotes(result.result);
    },
  );
}
