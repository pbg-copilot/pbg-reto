import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { withAuthorizedConversationTransaction } from "../../../shared/auth/authorization.js";
import { createClientProfileService } from "../client-profile-composition.js";
import { presentClientProfile } from "../presentation/client-profile-presenter.js";

export function registerClientProfileRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies): void {
  const service = createClientProfileService();
  app.get<{
    Params: { conversationId: string };
    Querystring: {
      limit?: number;
      beforeNoteIndex?: string;
      beforeActivityIndex?: string;
    };
  }>(
    "/api/conversations/:conversationId/client",
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
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            beforeNoteIndex: {
              type: "string",
              pattern: "^[1-9][0-9]{0,18}$",
            },
            beforeActivityIndex: {
              type: "string",
              pattern: "^[1-9][0-9]{0,18}$",
            },
          },
        },
      },
    },
    async (req, reply) => {
      const limit = req.query.limit ?? 20;
      const beforeNoteIndex = req.query.beforeNoteIndex ?? null;
      const beforeActivityIndex = req.query.beforeActivityIndex ?? null;
      if (
        (beforeNoteIndex !== null &&
          BigInt(beforeNoteIndex) > 9223372036854775807n) ||
        (beforeActivityIndex !== null &&
          BigInt(beforeActivityIndex) > 9223372036854775807n)
      )
        return reply.code(400).send({
          error: "invalid_request",
          message: "El cursor de notas o actividad no es válido.",
        });
      const result = await withAuthorizedConversationTransaction(
        pool,
        digest(tokenOf(req)),
        req.params.conversationId,
        (client, conversation, principal) => service.load(client, conversation, principal, {
          limit, beforeNoteIndex, beforeActivityIndex,
        }),
      );
      if (!result.authenticated)
        return reply.code(401).send({
          error: "unauthorized",
          message: "Inicia sesión para continuar.",
        });
      if (!result.authorized || result.result.state === "not_found")
        return reply.code(404).send({
          error: "not_found",
          message: "Conversación o cliente no encontrado.",
        });
      if (result.result.state === "client_not_selected")
        return reply.code(409).send({
          error: "client_not_selected",
          message: "Selecciona un cliente antes de consultar su expediente.",
        });
      return presentClientProfile(result.result, { limit, beforeNoteIndex, beforeActivityIndex });
    },
  );
}
