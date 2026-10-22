import type { PoolClient } from "pg";
import type { AuthorizedConversation, Principal } from "../../../shared/auth/authorization.js";
import type { AppointmentRow } from "../domain/appointment-model.js";
import type { AppointmentConfirmationRecord, AppointmentExecutionSnapshot, AuthorizedExecutionResult, PriorAppointmentExecution } from "../domain/appointment-execution.js";

export interface AppointmentExecutionTransactions {
  run<T>(tokenHash: string, conversationId: string,
    operation: (client: PoolClient, conversation: AuthorizedConversation, principal: Principal) => Promise<T>,
  ): Promise<AuthorizedExecutionResult<T>>;
}

export interface AppointmentExecutionAccess {
  hasClient(client: PoolClient, principal: Principal, clientPath: string, clientRecordId: string): Promise<boolean>;
  canManageAgent(client: PoolClient, principal: Principal, agentAccountId: string): Promise<boolean>;
}

export type AppointmentWriteResult = { state: "written"; appointment: AppointmentRow } | { state: "conflict" };

export interface AppointmentExecutionRepository {
  lockIdempotency(client: PoolClient, actorId: string, key: string): Promise<PriorAppointmentExecution | undefined>;
  findConfirmation(client: PoolClient, confirmationId: string, conversationId: string, actorId: string): Promise<AppointmentConfirmationRecord | undefined>;
  findTarget(client: PoolClient, appointmentId: string, conversationId: string, clientPath: string, clientRecordId: string): Promise<AppointmentRow | undefined>;
  invalidateConfirmation(client: PoolClient, confirmationId: string): Promise<void>;
  consumeConfirmation(client: PoolClient, confirmationId: string): Promise<void>;
  write(client: PoolClient, confirmation: AppointmentConfirmationRecord, conversationId: string, actorId: string): Promise<AppointmentWriteResult>;
}

export type AppointmentExecutionAuditEntry = {
  conversationId: string;
  actionType: "appointment.created" | "appointment.rescheduled" | "appointment.cancelled";
  entityId: string;
  outcome: "succeeded" | "rejected" | "conflict";
  errorCode: string | null;
  idempotencyKey: string;
  idempotencyFingerprint: string;
  resultSnapshot: AppointmentExecutionSnapshot;
};

export interface AppointmentExecutionAudit {
  record(client: PoolClient, principal: Principal, entry: AppointmentExecutionAuditEntry): Promise<void>;
}
