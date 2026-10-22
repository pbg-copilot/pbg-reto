import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ApiRequest } from "../../../shared/api/api-client";
import type { Conversation, Message } from "../../../shared/types/domain";

export type ClientContextOptions = {
  api: ApiRequest;
  agentId: string | undefined;
  activeConversationId: string;
  contextRequest: MutableRefObject<number>;
  activeConversationRef: MutableRefObject<string>;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setMessagesHasMore: Dispatch<SetStateAction<boolean>>;
  setMessagesCursor: Dispatch<SetStateAction<string | null>>;
  setMessageDraft: Dispatch<SetStateAction<string>>;
};

export type ClientSelectionDependencies = {
  resetAppointments: () => void;
  reloadHistory: (conversationId: string, requestId: number) => Promise<void>;
  loadAppointments: (conversationId: string, requestId: number) => Promise<void>;
};
