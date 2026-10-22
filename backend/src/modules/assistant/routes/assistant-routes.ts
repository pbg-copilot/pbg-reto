import type { FastifyInstance } from "fastify";
import type { AssistantConfig } from "../config/assistant-config.js";
import type { AssistantService } from "../services/assistant-service.js";
import { withAuthorizedConversationTransaction } from "../../../shared/auth/authorization.js";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";

type AssistantRouteDependencies = RouteDependencies & {
  assistantConfig: AssistantConfig;
  assistantService: AssistantService;
};

export function registerAssistantRoutes(
  app: FastifyInstance,
  { pool, digest, tokenOf, assistantConfig, assistantService }: AssistantRouteDependencies,
): void {
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
      const content = req.body.content.trim();
      if (!content) return reply.code(400).send({ error: "invalid_request", message: "El mensaje no puede estar vacío." });
      if (!assistantService.isEnabled()) return reply.code(503).send({ error: "assistant_unavailable", message: "La redacción asistida no está habilitada para este entorno." });

      const readAuthorizedEvidence = () => withAuthorizedConversationTransaction(
        pool, digest(tokenOf(req)), req.params.conversationId,
        async (client, conversation, principal) => {
          if (conversation.status !== "active") return { state: "archived" as const };
          return assistantService.loadEvidence(client, conversation, principal);
        },
      );
      const evidenceResult = await readAuthorizedEvidence();
      if (!evidenceResult.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
      if (!evidenceResult.authorized || evidenceResult.result.state === "not_found") return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
      if (evidenceResult.result.state === "archived") return reply.code(409).send({ error: "conversation_archived", message: "No se pueden agregar mensajes a una conversación archivada." });
      if (evidenceResult.result.state === "client_not_selected") return reply.code(409).send({ error: "client_not_selected", message: "Selecciona un cliente antes de preguntar al asistente." });
      if (evidenceResult.result.state !== "ready") return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
      const authorizedEvidence = evidenceResult.result;

      // Recheck the session, scope, and active client immediately before sending
      // data to the external provider; use evidence from this fresh read.
      const preflightResult = await readAuthorizedEvidence();
      if (!preflightResult.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Tu sesión venció. Inicia sesión para continuar." });
      if (!preflightResult.authorized || preflightResult.result.state === "not_found") return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
      if (preflightResult.result.state === "archived") return reply.code(409).send({ error: "conversation_archived", message: "No se pueden agregar mensajes a una conversación archivada." });
      if (preflightResult.result.state === "client_not_selected") return reply.code(409).send({ error: "client_not_selected", message: "Selecciona un cliente antes de preguntar al asistente." });
      if (preflightResult.result.state !== "ready") return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
      if (preflightResult.result.client.document_path !== authorizedEvidence.client.document_path || preflightResult.result.client.id !== authorizedEvidence.client.id)
        return reply.code(409).send({ error: "context_changed", message: "El cliente activo cambió durante la consulta. Vuelve a enviar la pregunta para el cliente seleccionado." });
      const freshAuthorizedEvidence = preflightResult.result;

      let answer: string;
      try {
        answer = await assistantService.draft(freshAuthorizedEvidence, content);
      } catch {
        return reply.code(502).send({ error: "assistant_provider_error", message: "El proveedor de redacción no respondió correctamente. No se generó ni guardó una respuesta; inténtalo de nuevo." });
      }
      const saveResult = await withAuthorizedConversationTransaction(
        pool, digest(tokenOf(req)), req.params.conversationId,
        async (client, conversation) => {
          if (conversation.status !== "active") return { state: "archived" as const };
          if (conversation.active_client_path !== freshAuthorizedEvidence.client.document_path || conversation.active_client_record_id !== freshAuthorizedEvidence.client.id) return { state: "context_changed" as const };
          const userMessage = await client.query(
            `INSERT INTO reto.chat_messages(
               conversation_id, sender_role, content,
               client_document_path, client_record_id
             )
             VALUES ($1, 'user', $2, $3, $4)
             RETURNING id, sequence_no, sender_role, content, created_at`,
            [conversation.id, content, freshAuthorizedEvidence.client.document_path, freshAuthorizedEvidence.client.id],
          );
          const assistantMessage = await client.query(
            `INSERT INTO reto.chat_messages(
               conversation_id, sender_role, content,
               client_document_path, client_record_id
             )
             VALUES ($1, 'assistant', $2, $3, $4)
             RETURNING id, sequence_no, sender_role, content, created_at`,
            [conversation.id, answer, freshAuthorizedEvidence.client.document_path, freshAuthorizedEvidence.client.id],
          );
          await client.query("UPDATE reto.chat_conversations SET updated_at = now() WHERE id = $1", [conversation.id]);
          return { state: "saved" as const, messages: [userMessage.rows[0], assistantMessage.rows[0]] };
        },
      );
      if (!saveResult.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Tu sesión venció. Inicia sesión para continuar." });
      if (!saveResult.authorized) return reply.code(404).send({ error: "not_found", message: "Conversación o cliente no encontrado." });
      if (saveResult.result.state === "context_changed") return reply.code(409).send({ error: "context_changed", message: "El cliente activo cambió durante la consulta. Vuelve a enviar la pregunta para el cliente seleccionado." });
      if (saveResult.result.state === "archived") return reply.code(409).send({ error: "conversation_archived", message: "No se pueden agregar mensajes a una conversación archivada." });
      return reply.code(201).send({ messages: saveResult.result.messages });
    },
  );


}
