import type { PoolClient } from "pg";
import type { AuthorizedConversation, Principal } from "../../../shared/auth/authorization-types.js";
import type { LocalDateTimeResolution } from "../../../shared/time/timezones.js";
import type { AppointmentAction } from "../domain/appointment-model.js";
import type { AppointmentConfirmationTarget, AuthorizedConfirmationResult } from "../domain/appointment-confirmation.js";

export interface AppointmentConfirmationTransactions {
  run<T>(tokenHash: string, conversationId: string,
    operation: (client: PoolClient, conversation: AuthorizedConversation, principal: Principal) => Promise<T>,
  ): Promise<AuthorizedConfirmationResult<T>>;
}

export interface AppointmentConfirmationAccess {
  hasClient(client: PoolClient, principal: Principal, clientPath: string, clientRecordId: string): Promise<boolean>;
  canManageAgent(client: PoolClient, principal: Principal, agentAccountId: string): Promise<boolean>;
}

export type AppointmentConfirmationWrite = {
  conversationId: string;
  requestedByAccountId: string;
  action: AppointmentAction;
  appointmentId: string | null;
  clientDocumentPath: string;
  clientRecordId: string;
  agentAccountId: string;
  interval: LocalDateTimeResolution;
  localStart: string;
  targetFingerprint: string | null;
};

export interface AppointmentConfirmationRepository {
  findTarget(client: PoolClient, appointmentId: string, conversationId: string, clientPath: string, clientRecordId: string): Promise<AppointmentConfirmationTarget | undefined>;
  insert(client: PoolClient, entry: AppointmentConfirmationWrite): Promise<{ id: string; expires_at: Date }>;
}
