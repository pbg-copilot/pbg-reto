import type { ApiRequest } from "../../../shared/api/api-client";
import type { Conversation, Message } from "../../../shared/types/domain";

export type ConversationHistory = {
  conversation: Conversation;
  messages: Message[];
  pagination: { hasMore: boolean; nextBeforeSequence: string | null };
};

export async function listConversations(api: ApiRequest, search?: string): Promise<Conversation[]> {
  const path = search === undefined
    ? "/api/conversations"
    : `/api/conversations?search=${encodeURIComponent(search)}`;
  const result = await api<{ conversations: Conversation[] }>(path);
  return result.conversations;
}

export async function createConversationRequest(api: ApiRequest): Promise<Conversation> {
  const result = await api<{ conversation: Conversation }>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title: "Nueva conversación" }),
  });
  return result.conversation;
}

export async function renameConversationRequest(
  api: ApiRequest, conversationId: string, title: string,
): Promise<Conversation> {
  const result = await api<{ conversation: Conversation }>(`/api/conversations/${conversationId}`, {
    method: "PATCH", body: JSON.stringify({ title }),
  });
  return result.conversation;
}

export function loadConversationHistory(
  api: ApiRequest, conversationId: string, beforeSequence?: string,
): Promise<ConversationHistory> {
  const cursor = beforeSequence === undefined ? "" : `&beforeSequence=${encodeURIComponent(beforeSequence)}`;
  return api<ConversationHistory>(`/api/conversations/${conversationId}?limit=100${cursor}`);
}
