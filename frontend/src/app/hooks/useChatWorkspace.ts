import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ApiRequest } from "../../shared/api/api-client";
import type { Agent, Client } from "../../shared/types/domain";
import type { WorkspaceModule } from "../../shared/ui/WorkspaceModal";
import type { ConsultationSelection } from "../../features/clients/components/ConsultationModule";
import { createConversationWorkspaceEffects, useConversationWorkspace } from "../../features/conversations/hooks/useConversationWorkspace";
import { useClientContext } from "../../features/clients/hooks/useClientContext";
import { useClientBriefing } from "../../features/clients/hooks/useClientBriefing";
import { useAppointmentWorkflow } from "../../features/appointments/hooks/useAppointmentWorkflow";
import { useFollowUps } from "../../features/follow-ups/hooks/useFollowUps";
import { useAssistantChat } from "./useAssistantChat";

export function useChatWorkspace({ api, agent }: { api: ApiRequest; agent: Agent }) {
  const [module, setModule] = useState<WorkspaceModule>("chat");
  const [consultation, setConsultation] = useState<ConsultationSelection>(null);
  const [followUpFormOpen, setFollowUpFormOpen] = useState(false);
  const effectsRef = useRef(createConversationWorkspaceEffects());
  const conversations = useConversationWorkspace({ api, agentId: agent.id, effectsRef });
  const clients = useClientContext({
    api, agentId: agent.id, activeConversationId: conversations.activeConversationId,
    contextRequest: conversations.contextRequest, activeConversationRef: conversations.activeConversationRef,
    setConversations: conversations.setConversations, setMessages: conversations.setMessages,
    setMessagesHasMore: conversations.setMessagesHasMore, setMessagesCursor: conversations.setMessagesCursor,
    setMessageDraft: conversations.setMessageDraft,
  });
  const appointments = useAppointmentWorkflow({
    api, agent, activeConversationId: conversations.activeConversationId, activeClient: clients.activeClient,
    contextRequest: conversations.contextRequest, activeConversationRef: conversations.activeConversationRef,
    setMessages: conversations.setMessages, setMessageDraft: conversations.setMessageDraft,
    setMessageBusy: conversations.setMessageBusy, setConversationError: conversations.setConversationError,
    setNotice: conversations.setNotice, setConversations: conversations.setConversations,
  });
  const followUps = useFollowUps({ api, conversationId: conversations.activeConversationId, client: clients.activeClient, role: agent.role });
  const briefing = useClientBriefing({
    api, conversationId: conversations.activeConversationId, hasClient: Boolean(clients.activeClient),
    contextRequest: conversations.contextRequest, activeConversationRef: conversations.activeConversationRef,
  });
  const assistant = useAssistantChat({ api, agentId: agent.id, conversations, clients, appointments });

  useLayoutEffect(() => {
    effectsRef.current = {
      resetClientContext: clients.reset, resetAppointmentWorkflow: appointments.reset,
      setActiveClient: clients.setActiveClient, loadProfile: clients.loadProfile,
      loadAppointments: appointments.loadAppointments, restoreAppointmentChatState: appointments.restoreChatState,
    };
  });
  useEffect(() => {
    if (conversations.conversationSearch.trim()) conversations.refreshConversationSearch();
  }, [conversations.messages.length, conversations.activeConversationId, conversations.conversationSearch,
    clients.activeClient?.document_path, clients.activeClient?.client_record_id, conversations.refreshConversationSearch]);

  function resetModule() {
    briefing.reset(); setFollowUpFormOpen(false); setModule("chat"); setConsultation(null);
  }
  async function selectClient(client: Client) {
    resetModule();
    try {
      await clients.selectClient(client, {
        resetAppointments: appointments.reset, reloadHistory: conversations.reloadConversationHistory,
        loadAppointments: appointments.loadAppointments,
      });
    } finally { conversations.refreshConversationSearch(); }
  }
  function activateConversation(id: string) { resetModule(); conversations.activateConversation(id); }
  function createConversation() { resetModule(); void conversations.createConversation(); }
  function changeModule(next: WorkspaceModule) {
    if (next === "consultas") setConsultation(null);
    if (next !== "ficha") briefing.clearError();
    setModule(next);
  }
  function showBriefing() {
    if (!conversations.activeConversationId || !clients.activeClient || briefing.loading) return;
    setModule("ficha"); setConsultation(null); void briefing.load();
  }
  function selectConsultation(next: Exclude<ConsultationSelection, null>) {
    setConsultation(next);
    const id = conversations.activeConversationId;
    if (!id) return;
    if (next === "profile") void clients.loadProfile(id);
    else void clients.loadQuotes(id);
  }

  return {
    conversations, clients, appointments, followUps, briefing, assistant,
    navigation: { module, consultation, changeModule, selectConsultation, backToChat: () => changeModule("chat") },
    followUpForm: { open: followUpFormOpen, show: () => setFollowUpFormOpen(true), close: () => setFollowUpFormOpen(false) },
    actions: { selectClient, activateConversation, createConversation, showBriefing },
  };
}

export type ChatWorkspaceController = ReturnType<typeof useChatWorkspace>;
