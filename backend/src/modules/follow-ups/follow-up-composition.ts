import type { Pool } from "pg";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../shared/auth/authorization.js";
import { PostgresFollowUpRepository } from "./repositories/follow-up-repository.js";
import { FollowUpService } from "./services/follow-up-service.js";

export function createFollowUpService(pool: Pool): FollowUpService {
  return new FollowUpService(
    { run: (tokenHash, conversationId, operation) => withAuthorizedConversationTransaction(pool, tokenHash, conversationId, operation) },
    new PostgresFollowUpRepository(),
    { getProfile: getAuthorizedClientProfile },
  );
}
