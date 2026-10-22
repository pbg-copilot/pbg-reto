import type { PoolClient } from "pg";
import type { AuthorizedClientProfile, AuthorizedConversation, Principal } from "../../../shared/auth/authorization-types.js";
import type { ConversationTransactionResult } from "../../conversations/services/conversation-transactions.js";
import type { FollowUpRecord, FollowUpWrite } from "../domain/follow-up-model.js";

export interface FollowUpTransactions {
  run<T>(tokenHash: string, conversationId: string,
    operation: (client: PoolClient, conversation: AuthorizedConversation, principal: Principal) => Promise<T>,
  ): Promise<ConversationTransactionResult<T>>;
}

export interface FollowUpAccess {
  getProfile(client: PoolClient, principal: Principal, clientPath: string, clientRecordId: string): Promise<AuthorizedClientProfile | null>;
}

export interface FollowUpRepository {
  listPending(client: PoolClient, actorAccountId: string, clientPath: string, clientRecordId: string): Promise<FollowUpRecord[]>;
  create(client: PoolClient, followUp: FollowUpWrite): Promise<FollowUpRecord | null>;
  complete(client: PoolClient, actorAccountId: string, clientPath: string, clientRecordId: string, followUpId: string): Promise<FollowUpRecord | null>;
  recordAction(client: PoolClient, conversationId: string, principal: Principal,
    action: "follow_up.created" | "follow_up.completed", followUpId: string,
  ): Promise<void>;
}
