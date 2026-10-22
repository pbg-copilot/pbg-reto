import type { AppointmentAction } from "./appointment-model.js";

export type PendingAppointmentChatConfirmation = {
  stage: "confirmation";
  id: string;
  expires_at: Date | string;
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
};

export type AppointmentChatStateRow = { stage: "details" } | PendingAppointmentChatConfirmation;

export type AppointmentChatStateOutcome =
  | { state: "idle" | "details" }
  | { state: "confirmation"; confirmation: PendingAppointmentChatConfirmation };
