import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, type ApiRequest } from "../../shared/api/api-client";
import type { Message } from "../../shared/types/domain";
import type { useConversationWorkspace } from "../../features/conversations/hooks/useConversationWorkspace";
import type { useClientContext } from "../../features/clients/hooks/useClientContext";
import type { useAppointmentWorkflow } from "../../features/appointments/hooks/useAppointmentWorkflow";

type Options = {
  api: ApiRequest;
  agentId: string;
  conversations: ReturnType<typeof useConversationWorkspace>;
  clients: ReturnType<typeof useClientContext>;
  appointments: ReturnType<typeof useAppointmentWorkflow>;
};

export function useAssistantChat({ api, agentId, conversations, clients, appointments }: Options) {
  const [enabled, setEnabled] = useState(false);
  const contextVersion = useRef(0);
  const clientPath = clients.activeClient?.document_path;
  const clientRecordId = clients.activeClient?.client_record_id;

  // Query refreshes do not change the conversation's client context.
  useLayoutEffect(() => {
    contextVersion.current += 1;
    return () => { contextVersion.current += 1; };
  }, [agentId, conversations.activeConversationId, clientPath, clientRecordId]);

  useEffect(() => {
    let current = true;
    setEnabled(false);
    void api<{ enabled: boolean }>("/api/assistant/status")
      .then((status) => { if (current) setEnabled(status.enabled); })
      .catch(() => { if (current) setEnabled(false); });
    return () => { current = false; };
  }, [api, agentId]);

  async function send() {
    const content = conversations.messageDraft.trim();
    const conversationId = conversations.activeConversationId;
    if (!content || !conversationId || !clients.activeClient || conversations.messageBusy) return;
    const requestVersion = contextVersion.current;
    const isCurrent = () => conversationId === conversations.activeConversationRef.current &&
      requestVersion === contextVersion.current;
    if (await appointments.handleChat(content)) return;
    if (!isCurrent()) return;
    if (!enabled) {
      conversations.setConversationError("El asistente está deshabilitado. Configura el proveedor para enviar preguntas normales; puedes iniciar una cita escribiendo “Agendar cita”.");
      return;
    }
    conversations.setMessageBusy(true);
    conversations.setConversationError("");
    conversations.setNotice("");
    try {
      const result = await api<{ messages: Message[] }>(`/api/conversations/${conversationId}/assistant`, {
        method: "POST", body: JSON.stringify({ content }),
      });
      if (!isCurrent()) return;
      conversations.setMessages((current) => [...current, ...result.messages]);
      conversations.setMessageDraft("");
      conversations.setNotice("Respuesta redactada con evidencia autorizada y guardada en el historial.");
      const updatedAt = result.messages.at(-1)?.created_at;
      if (updatedAt) conversations.setConversations((current) => current.map((item) =>
        item.id === conversationId ? { ...item, updated_at: updatedAt } : item));
    } catch (cause) {
      if (isCurrent() && !(cause instanceof ApiError && cause.status === 401))
        conversations.setConversationError(cause instanceof Error ? cause.message : "No se pudo redactar una respuesta.");
    } finally {
      conversations.setMessageBusy(false);
    }
  }

  return { enabled, send };
}
