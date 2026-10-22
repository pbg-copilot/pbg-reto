import type { LocalDateTimeError, LocalDateTimeResolution } from "../../../shared/time/timezones.js";
import type { AppointmentAction } from "./appointment-model.js";

export type AppointmentConfirmationBody = {
  action: AppointmentAction;
  appointmentId?: string;
  agentAccountId?: string;
  localStart?: string;
  durationMinutes?: number;
  timeZone?: string;
  utcOffsetMinutes?: number;
};

export type PrepareAppointmentConfirmationCommand = {
  tokenHash: string;
  conversationId: string;
  body: AppointmentConfirmationBody;
};

export type AppointmentConfirmationTarget = {
  id: string;
  conversation_id: string;
  client_document_path: string;
  client_record_id: string;
  agent_account_id: string;
  start_at: Date | string;
  end_at: Date | string;
  time_zone: string;
  local_start: string;
  start_utc_offset_minutes: number;
  status: "confirmed";
  last_confirmation_id: string | null;
};

export type PreparedAppointmentConfirmation = {
  id: string;
  expiresAt: Date;
  action: AppointmentAction;
  appointmentId: string | null;
  clientDocumentPath: string;
  clientRecordId: string;
  agentAccountId: string;
  interval: LocalDateTimeResolution;
};

export type AppointmentConfirmationOutcome =
  | { state: "archived" | "client_not_selected" | "client_not_found" | "appointment_not_found" | "agent_not_found" | "invalid_request" }
  | { state: "confirmed_for_review"; confirmation: PreparedAppointmentConfirmation };

export type AuthorizedConfirmationResult<T> =
  | { authenticated: false }
  | { authenticated: true; authorized: false }
  | { authenticated: true; authorized: true; result: T };

export type PrepareAppointmentConfirmationResult =
  | { state: "invalid_shape" }
  | { state: "local_time_error"; error: LocalDateTimeError }
  | AuthorizedConfirmationResult<AppointmentConfirmationOutcome>;

export interface AppointmentConfirmation {
  prepare(command: PrepareAppointmentConfirmationCommand): Promise<PrepareAppointmentConfirmationResult>;
}
