import type { PoolClient } from "pg";
import type { AppointmentConfirmationTarget } from "../domain/appointment-confirmation.js";
import type { AppointmentConfirmationRepository, AppointmentConfirmationWrite } from "../services/appointment-confirmation-ports.js";

export class PostgresAppointmentConfirmationRepository implements AppointmentConfirmationRepository {
  async findTarget(client: PoolClient, appointmentId: string, conversationId: string, clientPath: string, clientRecordId: string) {
    const { rows } = await client.query<AppointmentConfirmationTarget>(
      `SELECT id, conversation_id, client_document_path,
              client_record_id, agent_account_id, start_at, end_at,
              time_zone,
              to_char(local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
              start_utc_offset_minutes,
              status, last_confirmation_id
         FROM reto.chat_appointments
        WHERE id = $1
          AND conversation_id = $2
          AND client_document_path = $3
          AND client_record_id = $4
          AND status = 'confirmed'
        FOR UPDATE`,
      [
        appointmentId,
        conversationId,
        clientPath,
        clientRecordId,
      ],
    );

    return rows[0];
  }

  async insert(client: PoolClient, entry: AppointmentConfirmationWrite) {
    const { rows: confirmations } = await client.query<{ id: string; expires_at: Date }>(
      `INSERT INTO reto.chat_appointment_confirmations(
         conversation_id, requested_by_account_id, action,
         appointment_id, client_document_path, client_record_id,
         agent_account_id, start_at, end_at, time_zone, local_start,
         start_utc_offset_minutes, target_fingerprint
       ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, expires_at`,
      [
        entry.conversationId,
        entry.requestedByAccountId,
        entry.action,
        entry.appointmentId,
        entry.clientDocumentPath,
        entry.clientRecordId,
        entry.agentAccountId,
        entry.interval.startAt,
        entry.interval.endAt,
        entry.interval.timeZone,
        entry.localStart,
        entry.interval.startUtcOffsetMinutes,
        entry.targetFingerprint,
      ],
    );

    return confirmations[0];
  }
}
