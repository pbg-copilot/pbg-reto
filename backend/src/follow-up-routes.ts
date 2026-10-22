import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "./route-dependencies.js";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "./authorization.js";
import { PostgresFollowUpRepository } from "./follow-up-repository.js";

export function registerFollowUpRoutes(
  app: FastifyInstance,
  { pool, digest, tokenOf }: RouteDependencies,
): void {
  const followUps = new PostgresFollowUpRepository();
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
      const result = await withAuthorizedConversationTransaction(
        pool, digest(tokenOf(req)), req.params.conversationId,
        async (client, conversation, principal) => {
          if (!conversation.active_client_path || !conversation.active_client_record_id)
            return { state: "client_not_selected" as const };
          const profile = await getAuthorizedClientProfile(
            client, principal, conversation.active_client_path, conversation.active_client_record_id,
          );
          if (!profile) return { state: "client_not_found" as const };
          const items = await followUps.listPending(
            client, principal.accountId, conversation.active_client_path, conversation.active_client_record_id,
          );
          return { state: "loaded" as const, clientName: profile.name, followUps: items };
        },
      );
      if (!result.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
      if (!result.authorized || result.result.state === "client_not_found")
        return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
      if (result.result.state === "client_not_selected")
        return reply.code(409).send({ error: "client_not_selected", message: "Selecciona un cliente para consultar sus seguimientos." });
      return { client_name: result.result.clientName, follow_ups: result.result.followUps };
    },
  );

  app.post<{
    Params: { conversationId: string };
    Body: { description: string; dueDate: string; expectedClientPath: string; expectedClientRecordId: string };
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
      const description = req.body.description.trim();
      if (!description) return reply.code(400).send({ error: "invalid_request", message: "Escribe un detalle para el seguimiento." });
      const result = await withAuthorizedConversationTransaction(
        pool, digest(tokenOf(req)), req.params.conversationId,
        async (client, conversation, principal) => {
          if (principal.role !== "agent") return { state: "forbidden" as const };
          if (conversation.status !== "active") return { state: "conversation_archived" as const };
          if (!conversation.active_client_path || !conversation.active_client_record_id)
            return { state: "client_not_selected" as const };
          if (conversation.active_client_path !== req.body.expectedClientPath ||
              conversation.active_client_record_id !== req.body.expectedClientRecordId)
            return { state: "context_changed" as const };
          const profile = await getAuthorizedClientProfile(
            client, principal, conversation.active_client_path, conversation.active_client_record_id,
          );
          if (!profile) return { state: "client_not_found" as const };
          const followUp = await followUps.create(client, {
            conversationId: conversation.id,
            clientPath: conversation.active_client_path,
            clientRecordId: conversation.active_client_record_id,
            actorId: principal.accountId,
            description,
            dueDate: req.body.dueDate,
          });
          if (!followUp) return { state: "past_date" as const };
          await followUps.recordAction(client, conversation.id, principal, "follow_up.created", followUp.id);
          return { state: "created" as const, followUp, clientName: profile.name };
        },
      );
      if (!result.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
      if (!result.authorized || result.result.state === "client_not_found")
        return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
      if (result.result.state === "forbidden")
        return reply.code(403).send({ error: "forbidden", message: "Solo un agente puede registrar seguimientos." });
      if (result.result.state === "conversation_archived")
        return reply.code(409).send({ error: "conversation_archived", message: "No se puede registrar un seguimiento en una conversación archivada." });
      if (result.result.state === "client_not_selected")
        return reply.code(409).send({ error: "client_not_selected", message: "Selecciona un cliente antes de registrar un seguimiento." });
      if (result.result.state === "context_changed")
        return reply.code(409).send({ error: "context_changed", message: "El cliente activo cambió. Revisa la ficha e inténtalo otra vez." });
      if (result.result.state === "past_date")
        return reply.code(400).send({ error: "date_in_past", message: "La fecha del seguimiento no puede estar en el pasado." });
      return reply.code(201).send({ follow_up: result.result.followUp, client_name: result.result.clientName });
    },
  );

  app.patch<{
    Params: { conversationId: string; followUpId: string };
    Body: { expectedClientPath: string; expectedClientRecordId: string };
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
      const result = await withAuthorizedConversationTransaction(
        pool, digest(tokenOf(req)), req.params.conversationId,
        async (client, conversation, principal) => {
          if (principal.role !== "agent") return { state: "forbidden" as const };
          if (!conversation.active_client_path || !conversation.active_client_record_id)
            return { state: "client_not_selected" as const };
          if (conversation.active_client_path !== req.body.expectedClientPath ||
              conversation.active_client_record_id !== req.body.expectedClientRecordId)
            return { state: "context_changed" as const };
          const followUp = await followUps.complete(
            client, principal.accountId, conversation.active_client_path, conversation.active_client_record_id, req.params.followUpId,
          );
          if (!followUp) return { state: "not_found" as const };
          await followUps.recordAction(client, conversation.id, principal, "follow_up.completed", followUp.id);
          return { state: "completed" as const, followUp };
        },
      );
      if (!result.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
      if (!result.authorized || result.result.state === "not_found")
        return reply.code(404).send({ error: "not_found", message: "Seguimiento pendiente no encontrado." });
      if (result.result.state === "forbidden")
        return reply.code(403).send({ error: "forbidden", message: "Solo un agente puede cerrar seguimientos." });
      if (result.result.state === "client_not_selected")
        return reply.code(409).send({ error: "client_not_selected", message: "Selecciona un cliente para continuar." });
      if (result.result.state === "context_changed")
        return reply.code(409).send({ error: "context_changed", message: "El cliente activo cambió. Actualiza los seguimientos e inténtalo otra vez." });
      return { follow_up: result.result.followUp };
    },
  );
}
