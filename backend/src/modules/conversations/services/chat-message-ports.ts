import type { Database } from "../../../shared/auth/authorization-types.js";
import type { ConversationManagementTransactions, ConversationMessage } from "./conversation-management-ports.js";

export type ChatMessageTransactions = Pick<ConversationManagementTransactions, "authorized">;

export type NewChatMessage = {
  conversationId: string;
  content: string;
  clientDocumentPath: string | null;
  clientRecordId: string | null;
};

export interface ChatMessageRepository {
  save(db: Database, message: NewChatMessage): Promise<ConversationMessage>;
}
