import type { Pool } from "pg";
import { withAuthorizedConversationTransaction } from "../../shared/auth/authorization.js";
import { PostgresChatMessageRepository } from "./repositories/chat-message-repository.js";
import { ChatMessageService } from "./services/chat-message-service.js";

export function createChatMessageService(pool: Pool): ChatMessageService {
  return new ChatMessageService(
    { authorized: (tokenHash, conversationId, operation) => withAuthorizedConversationTransaction(pool, tokenHash, conversationId, operation) },
    new PostgresChatMessageRepository(),
  );
}
