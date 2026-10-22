import type { PoolClient } from "pg";
import type { AuthorizedConversation, Database, Principal } from "../../../shared/auth/authorization-types.js";
import type { ConversationTransactionResult } from "./conversation-transactions.js";

export type ConversationMessage = {
  id: string;
  sequence_no: string;
  sender_role: "user" | "assistant" | "tool";
  content: string;
  created_at: Date;
};

export type ConversationHistory = {
  conversation: AuthorizedConversation;
  messages: ConversationMessage[];
  pagination: { limit: number; hasMore: boolean; nextBeforeSequence: string | null };
};

export type AuthenticatedResult<T> =
  | { authenticated: false }
  | { authenticated: true; result: T };

type ConversationOperation<T> = (client: PoolClient, conversation: AuthorizedConversation, principal: Principal) => Promise<T>;

export interface ConversationManagementTransactions {
  authenticated<T>(tokenHash: string, operation: (client: PoolClient, principal: Principal) => Promise<T>): Promise<AuthenticatedResult<T>>;
  owned<T>(tokenHash: string, conversationId: string, operation: ConversationOperation<T>): Promise<ConversationTransactionResult<T>>;
  authorized<T>(tokenHash: string, conversationId: string, operation: ConversationOperation<T>): Promise<ConversationTransactionResult<T>>;
}

export interface ConversationManagementRepository {
  list(principal: Principal, search?: string): Promise<AuthorizedConversation[]>;
  create(db: Database, accountId: string, title: string | null): Promise<AuthorizedConversation>;
  rename(db: Database, conversationId: string, title: string): Promise<AuthorizedConversation>;
  listMessages(db: Database, conversation: AuthorizedConversation, beforeSequence: string | null, limit: number): Promise<ConversationMessage[]>;
}
