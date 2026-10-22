import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { ApiRequest } from "../../../shared/api/api-client";
import type { Agent, AppointmentConfirmation, Client, Conversation, Message } from "../../../shared/types/domain";

export type PendingAppointment = { confirmation: AppointmentConfirmation; idempotencyKey: string } | null;

export type AppointmentWorkflowOptions = {
  api: ApiRequest;
  agent: Agent | null;
  activeConversationId: string;
  activeClient: Client | null;
  contextRequest: MutableRefObject<number>;
  activeConversationRef: MutableRefObject<string>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setMessageDraft: Dispatch<SetStateAction<string>>;
  setMessageBusy: Dispatch<SetStateAction<boolean>>;
  setConversationError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
};

export type AppointmentContextGuard = (conversationId: string, requestId: number) => boolean;
export type LoadAppointments = (conversationId: string, requestId?: number) => Promise<void>;
