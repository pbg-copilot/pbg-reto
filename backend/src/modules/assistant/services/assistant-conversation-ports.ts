import type { PoolClient } from "pg";
import type { AuthorizedConversation, Principal } from "../../../shared/auth/authorization-types.js";
import type { ConversationTransactionResult } from "../../conversations/services/conversation-transactions.js";
import type { ConversationMessage } from "../../conversations/services/conversation-management-ports.js";
import type { AssistantEvidenceResult } from "../repositories/assistant-evidence-repository.js";

export interface AssistantConversationPort {
  isEnabled(): boolean;
  loadEvidence(client: PoolClient, conversation: AuthorizedConversation, principal: Principal): Promise<AssistantEvidenceResult>;
  draft(evidence: unknown, question: string): Promise<string>;
}

export interface AssistantConversationTransactions {
  run<T>(
    tokenHash: string,
    conversationId: string,
    operation: (client: PoolClient, conversation: AuthorizedConversation, principal: Principal) => Promise<T>,
  ): Promise<ConversationTransactionResult<T>>;
}

export type AssistantExchange = {
  conversationId: string;
  clientDocumentPath: string;
  clientRecordId: string;
  question: string;
  answer: string;
};

export interface AssistantMessageRepository {
  saveExchange(client: PoolClient, exchange: AssistantExchange): Promise<ConversationMessage[]>;
}
