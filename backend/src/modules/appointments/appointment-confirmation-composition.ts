import type { Pool } from "pg";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../shared/auth/authorization.js";
import { PostgresAppointmentConfirmationRepository } from "./repositories/appointment-confirmation-repository.js";
import { AppointmentConfirmationService } from "./services/appointment-confirmation-service.js";
import { isAuthorizedAppointmentAgent } from "./services/appointment-authorization.js";
import type { AppointmentConfirmation } from "./domain/appointment-confirmation.js";

export function createAppointmentConfirmationService(pool: Pool): AppointmentConfirmation {
  return new AppointmentConfirmationService(
    { run: (tokenHash, conversationId, operation) => withAuthorizedConversationTransaction(pool, tokenHash, conversationId, operation) },
    new PostgresAppointmentConfirmationRepository(),
    {
      hasClient: async (client, principal, clientPath, clientRecordId) =>
        Boolean(await getAuthorizedClientProfile(client, principal, clientPath, clientRecordId)),
      canManageAgent: isAuthorizedAppointmentAgent,
    },
  );
}
