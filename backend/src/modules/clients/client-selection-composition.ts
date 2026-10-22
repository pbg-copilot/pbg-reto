import type { Pool } from "pg";
import { withOwnedConversationTransaction } from "../../shared/auth/authorization.js";
import { PostgresClientSelectionRepository } from "./repositories/client-selection-repository.js";
import { ClientSelectionService } from "./services/client-selection-service.js";

export function createClientSelectionService(pool: Pool): ClientSelectionService {
  return new ClientSelectionService(
    {
      run: (tokenHash, conversationId, operation) => withOwnedConversationTransaction(
        pool, tokenHash, conversationId,
        (client, principal, conversation) => operation(client, conversation, principal),
      ),
    },
    new PostgresClientSelectionRepository(),
  );
}
