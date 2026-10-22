import type { Pool } from "pg";
import { withAuthenticatedTransaction, withAuthorizedConversationTransaction, withOwnedConversationTransaction } from "../../shared/auth/authorization.js";
import { PostgresConversationManagementRepository } from "./repositories/conversation-management-repository.js";
import { ConversationManagementService } from "./services/conversation-management-service.js";

export function createConversationManagementService(pool: Pool): ConversationManagementService {
  return new ConversationManagementService(
    {
      authenticated: (tokenHash, operation) => withAuthenticatedTransaction(pool, tokenHash, operation),
      authorized: (tokenHash, conversationId, operation) => withAuthorizedConversationTransaction(pool, tokenHash, conversationId, operation),
      owned: (tokenHash, conversationId, operation) => withOwnedConversationTransaction(
        pool, tokenHash, conversationId, (client, principal, conversation) => operation(client, conversation, principal),
      ),
    },
    new PostgresConversationManagementRepository(pool),
  );
}
