import { useEffect, useRef, useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from "react";
import { ApiError } from "../api-client";
import type { ApiRequest } from "../appointment-api";
import type { Client, Conversation, Message } from "../domain";

type ConversationHistory = {
  conversation: Conversation;
  messages: Message[];
  pagination: { hasMore: boolean; nextBeforeSequence: string | null };
};

export type ConversationWorkspaceEffects = {
  resetClientContext: () => void;
  resetAppointmentWorkflow: () => void;
  setActiveClient: Dispatch<SetStateAction<Client | null>>;
  loadProfile: (conversationId: string, requestId?: number) => Promise<unknown>;
  loadAppointments: (conversationId: string, requestId?: number) => Promise<unknown>;
  restoreAppointmentChatState: (conversationId: string, requestId: number) => Promise<unknown>;
};

type Options = {
  api: ApiRequest;
  agentId?: string;
  effectsRef: MutableRefObject<ConversationWorkspaceEffects>;
};

const emptyEffects: ConversationWorkspaceEffects = {
  resetClientContext: () => undefined,
  resetAppointmentWorkflow: () => undefined,
  setActiveClient: () => undefined,
  loadProfile: async () => undefined,
  loadAppointments: async () => undefined,
  restoreAppointmentChatState: async () => undefined,
};

export function createConversationWorkspaceEffects(): ConversationWorkspaceEffects {
  return { ...emptyEffects };
}

export function useConversationWorkspace({ api, agentId, effectsRef }: Options) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [renamingConversationId, setRenamingConversationId] = useState("");
  const [conversationTitleDraft, setConversationTitleDraft] = useState("");
  const [renamingConversationBusy, setRenamingConversationBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [messageBusy, setMessageBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const contextRequest = useRef(0);
  const activeConversationRef = useRef("");

  function reset() {
    contextRequest.current += 1;
    activeConversationRef.current = "";
    setConversations([]);
    setActiveConversationId("");
    setRenamingConversationId("");
    setConversationTitleDraft("");
    setRenamingConversationBusy(false);
    setMessages([]);
    setMessagesHasMore(false);
    setMessagesCursor(null);
    setHistoryLoading(false);
    setConversationLoading(false);
    setConversationError("");
    setMessageDraft("");
    setMessageBusy(false);
    setNotice("");
    effectsRef.current.resetAppointmentWorkflow();
    effectsRef.current.resetClientContext();
  }

  async function createConversation() {
    try {
      const result = await api<{ conversation: Conversation }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "Nueva conversación" }),
      });
      setConversations((current) => [result.conversation, ...current]);
      activateConversation(result.conversation.id);
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401))
        setConversationError(cause instanceof Error ? cause.message : "No se pudo crear la conversación.");
    }
  }

  async function saveConversationTitle(event: FormEvent, conversationId: string) {
    event.preventDefault();
    const title = conversationTitleDraft.trim();
    if (!title || !conversationId || renamingConversationBusy) return;
    setRenamingConversationBusy(true);
    setConversationError("");
    try {
      const result = await api<{ conversation: Conversation }>(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      setConversations((current) => [result.conversation, ...current.filter((item) => item.id !== conversationId)]);
      setRenamingConversationId("");
      setConversationTitleDraft("");
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401))
        setConversationError(cause instanceof Error ? cause.message : "No se pudo cambiar el nombre.");
    } finally {
      setRenamingConversationBusy(false);
    }
  }

  function beginRenameConversation(conversation: Conversation) {
    setRenamingConversationId(conversation.id);
    setConversationTitleDraft(conversation.title || "");
    setConversationError("");
  }

  function cancelRenameConversation() {
    setRenamingConversationId("");
    setConversationTitleDraft("");
  }

  async function reloadConversationHistory(conversationId: string, requestId: number) {
    const history = await api<ConversationHistory>(`/api/conversations/${conversationId}?limit=100`);
    if (requestId !== contextRequest.current || conversationId !== activeConversationRef.current) return;
    setMessages(history.messages);
    setMessagesHasMore(history.pagination.hasMore);
    setMessagesCursor(history.pagination.nextBeforeSequence);
  }

  async function loadOlderMessages() {
    if (!activeConversationId || !messagesCursor || historyLoading) return;
    const conversationId = activeConversationId;
    const requestId = contextRequest.current;
    setHistoryLoading(true);
    try {
      const result = await api<{ messages: Message[]; pagination: ConversationHistory["pagination"] }>(
        `/api/conversations/${conversationId}?limit=100&beforeSequence=${encodeURIComponent(messagesCursor)}`,
      );
      if (requestId !== contextRequest.current || conversationId !== activeConversationId) return;
      setMessages((current) => [...result.messages, ...current]);
      setMessagesHasMore(result.pagination.hasMore);
      setMessagesCursor(result.pagination.nextBeforeSequence);
    } catch (cause) {
      if (requestId === contextRequest.current && conversationId === activeConversationRef.current && !(cause instanceof ApiError && cause.status === 401))
        setConversationError(cause instanceof Error ? cause.message : "No se pudo cargar el historial anterior.");
    } finally {
      if (requestId === contextRequest.current && conversationId === activeConversationRef.current)
        setHistoryLoading(false);
    }
  }

  function activateConversation(conversationId: string) {
    setRenamingConversationId("");
    setConversationTitleDraft("");
    contextRequest.current += 1;
    effectsRef.current.resetAppointmentWorkflow();
    activeConversationRef.current = conversationId;
    setActiveConversationId(conversationId);
    setMessages([]);
    setMessagesHasMore(false);
    setMessagesCursor(null);
    setHistoryLoading(false);
    effectsRef.current.resetClientContext();
    setMessageDraft("");
    setNotice("");
    setConversationError("");
  }

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setConversationError("");
    api<{ conversations: Conversation[] }>("/api/conversations").then((result) => {
      if (cancelled) return;
      setConversations(result.conversations);
      const current = activeConversationRef.current;
      const next = current && result.conversations.some((item) => item.id === current)
        ? current
        : result.conversations[0]?.id ?? "";
      activeConversationRef.current = next;
      setActiveConversationId(next);
    }).catch((cause) => {
      if (!cancelled && !(cause instanceof ApiError && cause.status === 401))
        setConversationError(cause instanceof Error ? cause.message : "No se pudieron cargar las conversaciones.");
    });
    return () => { cancelled = true; };
  }, [agentId, api]);

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      setMessagesHasMore(false);
      setMessagesCursor(null);
      effectsRef.current.resetClientContext();
      return;
    }
    const requestId = ++contextRequest.current;
    let cancelled = false;
    setConversationLoading(true);
    setConversationError("");
    setMessages([]);
    setMessagesHasMore(false);
    setMessagesCursor(null);
    effectsRef.current.resetClientContext();
    effectsRef.current.resetAppointmentWorkflow();
    setMessageDraft("");
    setNotice("");
    api<ConversationHistory>(`/api/conversations/${activeConversationId}?limit=100`).then(async (history) => {
      if (cancelled || requestId !== contextRequest.current) return;
      setMessages(history.messages);
      setMessagesHasMore(history.pagination.hasMore);
      setMessagesCursor(history.pagination.nextBeforeSequence);
      const conversation = history.conversation;
      setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, ...conversation } : item));
      if (conversation.active_client_path && conversation.active_client_record_id) {
        effectsRef.current.setActiveClient({
          document_path: conversation.active_client_path,
          client_record_id: conversation.active_client_record_id,
          name: "Cliente seleccionado",
          email: null,
          phone: null,
          stage: null,
        });
        await Promise.all([
          effectsRef.current.loadProfile(conversation.id, requestId),
          effectsRef.current.loadAppointments(conversation.id, requestId),
          effectsRef.current.restoreAppointmentChatState(conversation.id, requestId),
        ]);
      }
    }).catch((cause) => {
      if (!cancelled && requestId === contextRequest.current && !(cause instanceof ApiError && cause.status === 401))
        setConversationError(cause instanceof Error ? cause.message : "No se pudo abrir la conversación.");
    }).finally(() => {
      if (!cancelled && requestId === contextRequest.current) setConversationLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeConversationId, agentId, api]);

  return {
    conversations, setConversations, activeConversationId, setActiveConversationId,
    renamingConversationId, conversationTitleDraft, renamingConversationBusy,
    setConversationTitleDraft, messages, setMessages, messagesHasMore, setMessagesHasMore,
    messagesCursor, setMessagesCursor, historyLoading, conversationLoading, conversationError,
    setConversationError, messageDraft, setMessageDraft, messageBusy, setMessageBusy,
    setConversationLoading, notice, setNotice, contextRequest, activeConversationRef,
    reset, createConversation, saveConversationTitle, beginRenameConversation,
    cancelRenameConversation, reloadConversationHistory, loadOlderMessages, activateConversation,
  };
}
