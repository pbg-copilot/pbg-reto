import type { Pool } from "pg";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../shared/auth/authorization.js";
import { PostgresAppointmentChatStateRepository } from "./repositories/appointment-chat-state-repository.js";
import { isAuthorizedAppointmentAgent } from "./services/appointment-authorization.js";
import { AppointmentChatStateService } from "./services/appointment-chat-state-service.js";

export function createAppointmentChatStateService(pool: Pool): AppointmentChatStateService {
  return new AppointmentChatStateService(
    { run: (tokenHash, conversationId, operation) => withAuthorizedConversationTransaction(pool, tokenHash, conversationId, operation) },
    new PostgresAppointmentChatStateRepository(),
    {
      hasClient: async (client, principal, clientPath, clientRecordId) =>
        Boolean(await getAuthorizedClientProfile(client, principal, clientPath, clientRecordId)),
      canManageAgent: isAuthorizedAppointmentAgent,
    },
  );
}
