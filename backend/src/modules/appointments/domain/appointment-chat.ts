import type { ConversationMessage } from "../../conversations/services/conversation-management-ports.js";
import type { ConversationTransactionResult } from "../../conversations/services/conversation-transactions.js";
import type { AppointmentAction } from "./appointment-model.js";

export type AppointmentChatKind =
  | "request_details" | "invalid_details" | "review" | "repeat_confirmation"
  | "created" | "conflict" | "cancelled" | "appointments_list";

export type AppointmentChatBody = {
  content: string;
  kind: AppointmentChatKind;
  expectedClientPath: string;
  expectedClientRecordId: string;
  confirmationId?: string;
  appointmentId?: string;
};

export type AppointmentChatCommand = {
  tokenHash: string;
  conversationId: string;
  body: AppointmentChatBody;
};

export type AppointmentChatScope = {
  conversationId: string;
  accountId: string;
  clientPath: string;
  clientRecordId: string;
};

export type AppointmentChatSummary = {
  agent_account_id: string;
  local_date: string;
  local_time: string;
  start_utc_offset_minutes: number;
  duration_minutes: number;
  time_zone: string;
};

export type AppointmentChatConfirmation = AppointmentChatSummary & { action: AppointmentAction };

export type AppointmentChatOutcome =
  | { state: "archived" | "agent_only" | "client_not_selected" | "context_changed" | "client_not_found" | "conflict_not_found" | "confirmation_not_found" | "appointment_not_found" }
  | { state: "saved"; messages: ConversationMessage[] };

export type AppointmentChatResult =
  | { state: "empty_content" | "invalid_details" }
  | ConversationTransactionResult<AppointmentChatOutcome>;

export interface AppointmentChat {
  send(command: AppointmentChatCommand): Promise<AppointmentChatResult>;
}
