import type { PoolClient } from "pg";
import type { AuthorizedClientProfile, AuthorizedConversation, Database, Principal } from "../../../shared/auth/authorization-types.js";
import type { ConversationMessage } from "../../conversations/services/conversation-management-ports.js";
import type { ConversationTransactionResult } from "../../conversations/services/conversation-transactions.js";
import type { AppointmentChatConfirmation, AppointmentChatScope, AppointmentChatSummary } from "../domain/appointment-chat.js";

export interface AppointmentChatTransactions {
  run<T>(tokenHash: string, conversationId: string,
    operation: (client: PoolClient, conversation: AuthorizedConversation, principal: Principal) => Promise<T>,
  ): Promise<ConversationTransactionResult<T>>;
}

export interface AppointmentChatAccess {
  getProfile(client: PoolClient, principal: Principal, clientPath: string, clientRecordId: string): Promise<AuthorizedClientProfile | null>;
  canManageAgent(client: PoolClient, principal: Principal, agentAccountId: string): Promise<boolean>;
}

export interface AppointmentChatRepository {
  findAgentName(db: Database, accountId: string): Promise<string | null>;
  hasRecentConflict(db: Database, scope: AppointmentChatScope): Promise<boolean>;
  findConfirmation(db: Database, scope: AppointmentChatScope, confirmationId: string): Promise<AppointmentChatConfirmation | undefined>;
  findCreatedAppointment(db: Database, scope: AppointmentChatScope, appointmentId: string): Promise<AppointmentChatSummary | undefined>;
  listAppointments(db: Database, scope: AppointmentChatScope): Promise<AppointmentChatSummary[]>;
  saveDetailsState(db: Database, scope: AppointmentChatScope): Promise<void>;
  saveConfirmationState(db: Database, scope: AppointmentChatScope, confirmationId: string): Promise<void>;
  clearState(db: Database, scope: AppointmentChatScope): Promise<void>;
  saveTurn(db: Database, scope: AppointmentChatScope, content: string, response: string): Promise<ConversationMessage[]>;
}
