import type { PoolClient } from "pg";
import type { AuthorizedClient, AuthorizedConversation, Database, Principal } from "../../../shared/auth/authorization-types.js";
import type { ConversationTransactionResult } from "../../conversations/services/conversation-transactions.js";

export type ClientSelectionInput = { documentPath: string; clientRecordId: string };
export type ClientSelectionAction = "client.selected" | "client.changed";

export interface ClientSelectionTransactions {
  run<T>(tokenHash: string, conversationId: string,
    operation: (client: PoolClient, conversation: AuthorizedConversation, principal: Principal) => Promise<T>,
  ): Promise<ConversationTransactionResult<T>>;
}

export interface ClientSelectionRepository {
  findClient(db: Database, principal: Principal, documentPath: string, clientRecordId: string): Promise<AuthorizedClient | null>;
  setActiveClient(db: Database, conversationId: string, selected: AuthorizedClient): Promise<void>;
  recordSelection(db: Database, principal: Principal, conversationId: string, action: ClientSelectionAction, selected: AuthorizedClient): Promise<void>;
}
