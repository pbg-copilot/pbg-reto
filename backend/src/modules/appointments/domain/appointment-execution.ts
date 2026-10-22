import type { AppointmentAction, AppointmentRow } from "./appointment-model.js";

export type ExecuteAppointmentCommand = {
  tokenHash: string;
  conversationId: string;
  confirmationId: string;
  idempotencyKey: string;
};

export type AppointmentConfirmationRecord = AppointmentRow & {
  id: string;
  conversation_id: string;
  requested_by_account_id: string;
  action: AppointmentAction;
  appointment_id: string | null;
  client_document_path: string;
  client_record_id: string;
  agent_account_id: string;
  start_at: Date | string;
  end_at: Date | string;
  time_zone: string;
  local_start: string;
  start_utc_offset_minutes: number;
  target_fingerprint: string | null;
  status: "pending" | "consumed" | "invalidated";
  expires_at: Date | string;
};

export type AppointmentExecutionSnapshot = Record<string, unknown>;
export type PriorAppointmentExecution = {
  conversation_id: string;
  outcome: string;
  error_code: string | null;
  idempotency_fingerprint: string | null;
  result_snapshot: AppointmentExecutionSnapshot | null;
};

export type AppointmentExecutionOutcome =
  | { state: "archived" | "client_not_selected" | "client_not_found" | "invalid_confirmation" | "confirmation_already_used" | "idempotency_key_reused" }
  | { state: "replayed"; outcome: string; errorCode: string | null; resultSnapshot: AppointmentExecutionSnapshot | null }
  | { state: "rejected" | "conflict" | "succeeded"; resultSnapshot: AppointmentExecutionSnapshot };

export type AuthorizedExecutionResult<T> =
  | { authenticated: false }
  | { authenticated: true; authorized: false }
  | { authenticated: true; authorized: true; result: T };

export type ExecuteAppointmentResult = AuthorizedExecutionResult<AppointmentExecutionOutcome>;

export interface AppointmentExecution {
  execute(command: ExecuteAppointmentCommand): Promise<ExecuteAppointmentResult>;
}
