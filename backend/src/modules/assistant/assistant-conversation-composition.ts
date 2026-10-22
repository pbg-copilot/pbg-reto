import type { Pool } from "pg";
import { withAuthorizedConversationTransaction } from "../../shared/auth/authorization.js";
import { PostgresAssistantMessageRepository } from "./repositories/assistant-message-repository.js";
import type { AssistantConversationPort } from "./services/assistant-conversation-ports.js";
import { AssistantConversationService } from "./services/assistant-conversation-service.js";

export function createAssistantConversationService(pool: Pool, assistant: AssistantConversationPort): AssistantConversationService {
  return new AssistantConversationService(
    { run: (tokenHash, conversationId, operation) => withAuthorizedConversationTransaction(pool, tokenHash, conversationId, operation) },
    assistant,
    new PostgresAssistantMessageRepository(),
  );
}
