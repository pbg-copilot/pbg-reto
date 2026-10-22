import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import type { ClientSelectionInput } from "../services/client-selection-ports.js";
import { createClientSelectionService } from "../client-selection-composition.js";
import { clientSelectionResponse } from "../presentation/client-selection-response.js";

export function registerClientSelectionRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies): void {
  const selection = createClientSelectionService(pool);
  app.post<{
    Params: { conversationId: string };
    Body: ClientSelectionInput;
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
        body: {
          type: "object",
          additionalProperties: false,
          required: ["documentPath", "clientRecordId"],
          properties: {
            documentPath: {
              type: "string",
              minLength: 1,
              maxLength: 512,
              pattern: "^leads-store/books/[^\\s]+$",
            },
            clientRecordId: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await selection.select(digest(tokenOf(req)), req.params.conversationId, req.body);
      const response = clientSelectionResponse(result);
      return reply.code(response.statusCode).send(response.body);
    },
  );
}
