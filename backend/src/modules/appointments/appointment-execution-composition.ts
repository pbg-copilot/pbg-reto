import type { Pool } from "pg";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../shared/auth/authorization.js";
import { PostgresAppointmentExecutionRepository } from "./repositories/appointment-execution-repository.js";
import { recordAppointmentAction } from "./repositories/appointment-audit-repository.js";
import { isAuthorizedAppointmentAgent } from "./services/appointment-authorization.js";
import { AppointmentExecutionService } from "./services/appointment-execution-service.js";
import type { AppointmentExecution } from "./domain/appointment-execution.js";

export function createAppointmentExecutionService(pool: Pool): AppointmentExecution {
  return new AppointmentExecutionService(
    { run: (tokenHash, conversationId, operation) => withAuthorizedConversationTransaction(pool, tokenHash, conversationId, operation) },
    new PostgresAppointmentExecutionRepository(),
    {
      hasClient: async (client, principal, clientPath, clientRecordId) =>
        Boolean(await getAuthorizedClientProfile(client, principal, clientPath, clientRecordId)),
      canManageAgent: isAuthorizedAppointmentAgent,
    },
    {
      record: (client, principal, entry) => recordAppointmentAction(client, principal, entry.conversationId,
        entry.actionType, entry.entityId, entry.outcome, entry.errorCode,
        entry.idempotencyKey, entry.idempotencyFingerprint, entry.resultSnapshot),
    },
  );
}
