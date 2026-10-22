import type { Pool } from "pg";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../shared/auth/authorization.js";
import type { AppointmentChat } from "./domain/appointment-chat.js";
import { PostgresAppointmentChatRepository } from "./repositories/appointment-chat-repository.js";
import { AppointmentChatService } from "./services/appointment-chat-service.js";
import { isAuthorizedAppointmentAgent } from "./services/appointment-authorization.js";

export function createAppointmentChatService(pool: Pool): AppointmentChat {
  return new AppointmentChatService(
    { run: (tokenHash, conversationId, operation) => withAuthorizedConversationTransaction(pool, tokenHash, conversationId, operation) },
    new PostgresAppointmentChatRepository(),
    { getProfile: getAuthorizedClientProfile, canManageAgent: isAuthorizedAppointmentAgent },
  );
}
