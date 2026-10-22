import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import { ApiError, type ApiRequest } from "../../../shared/api/api-client";
import type { Conversation } from "../../../shared/types/domain";
import { renameConversationRequest } from "../services/conversation-api";

type Options = {
  api: ApiRequest;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setConversationError: Dispatch<SetStateAction<string>>;
  refreshConversationSearch: () => void;
};

export function useConversationTitle(options: Options) {
  const [renamingConversationId, setRenamingConversationId] = useState("");
  const [conversationTitleDraft, setConversationTitleDraft] = useState("");
  const [renamingConversationBusy, setRenamingConversationBusy] = useState(false);

  function cancelRenameConversation() {
    setRenamingConversationId("");
    setConversationTitleDraft("");
  }

  function reset() {
    cancelRenameConversation();
    setRenamingConversationBusy(false);
  }

  function beginRenameConversation(conversation: Conversation) {
    setRenamingConversationId(conversation.id);
    setConversationTitleDraft(conversation.title || "");
    options.setConversationError("");
  }

  async function saveConversationTitle(event: FormEvent, conversationId: string) {
    event.preventDefault();
    const title = conversationTitleDraft.trim();
    if (!title || !conversationId || renamingConversationBusy) return;
    setRenamingConversationBusy(true);
    options.setConversationError("");
    try {
      const conversation = await renameConversationRequest(options.api, conversationId, title);
      options.setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversationId)]);
      cancelRenameConversation();
      options.refreshConversationSearch();
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401))
        options.setConversationError(cause instanceof Error ? cause.message : "No se pudo cambiar el nombre.");
    } finally {
      setRenamingConversationBusy(false);
    }
  }

  return {
    renamingConversationId, conversationTitleDraft, renamingConversationBusy, setConversationTitleDraft,
    beginRenameConversation, cancelRenameConversation, saveConversationTitle, reset,
  };
}
