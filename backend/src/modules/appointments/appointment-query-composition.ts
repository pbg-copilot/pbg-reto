import type { Pool } from "pg";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../shared/auth/authorization.js";
import { PostgresAppointmentQueryRepository } from "./repositories/appointment-query-repository.js";
import { isAuthorizedAppointmentAgent } from "./services/appointment-authorization.js";
import { AppointmentQueryService } from "./services/appointment-query-service.js";

export function createAppointmentQueryService(pool: Pool): AppointmentQueryService {
  return new AppointmentQueryService(
    { authorized: (tokenHash, conversationId, operation) => withAuthorizedConversationTransaction(pool, tokenHash, conversationId, operation) },
    new PostgresAppointmentQueryRepository(),
    { getProfile: getAuthorizedClientProfile, canReadAgent: isAuthorizedAppointmentAgent },
  );
}
