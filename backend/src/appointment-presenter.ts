import { createHash } from "node:crypto";
import type { AppointmentRow } from "./appointment-model.js";

export function appointmentTargetFingerprint(row: AppointmentRow): string {
  const snapshot = {
    id: row.id,
    conversation_id: row.conversation_id,
    client_document_path: row.client_document_path,
    client_record_id: row.client_record_id,
    agent_account_id: row.agent_account_id,
    start_at: new Date(row.start_at).toISOString(),
    end_at: new Date(row.end_at).toISOString(),
    time_zone: row.time_zone,
    local_start: String(row.local_start),
    start_utc_offset_minutes: Number(row.start_utc_offset_minutes),
    status: row.status,
    last_confirmation_id: row.last_confirmation_id,
  };
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

export function publicAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    client_document_path: row.client_document_path,
    client_record_id: row.client_record_id,
    agent_account_id: row.agent_account_id,
    start_at: new Date(row.start_at).toISOString(),
    end_at: new Date(row.end_at).toISOString(),
    time_zone: row.time_zone,
    local_start: String(row.local_start),
    start_utc_offset_minutes: Number(row.start_utc_offset_minutes),
    status: row.status,
  };
}
