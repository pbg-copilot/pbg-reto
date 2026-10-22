import type { PoolClient } from "pg";
import type { AppointmentRow } from "../domain/appointment-model.js";
import type { AppointmentConfirmationRecord, PriorAppointmentExecution } from "../domain/appointment-execution.js";
import type { AppointmentExecutionRepository, AppointmentWriteResult } from "../services/appointment-execution-ports.js";

const appointmentProjection = `id, conversation_id, client_document_path,
  client_record_id, agent_account_id, start_at, end_at, time_zone,
  to_char(local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
  start_utc_offset_minutes, status`;

export class PostgresAppointmentExecutionRepository implements AppointmentExecutionRepository {
  async lockIdempotency(client: PoolClient, actorId: string, key: string) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${actorId}:${key}`]);
    const { rows } = await client.query<PriorAppointmentExecution>(
      `SELECT conversation_id, outcome, error_code, idempotency_fingerprint, result_snapshot
         FROM reto.chat_actions
        WHERE actor_account_id = $1 AND idempotency_key = $2
        FOR UPDATE`, [actorId, key],
    );
    return rows[0];
  }

  async findConfirmation(client: PoolClient, confirmationId: string, conversationId: string, actorId: string) {
    const { rows } = await client.query<AppointmentConfirmationRecord>(
      `SELECT id, conversation_id, requested_by_account_id, action,
              appointment_id, client_document_path, client_record_id,
              agent_account_id, start_at, end_at, time_zone,
              to_char(local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
              start_utc_offset_minutes, target_fingerprint, status, expires_at
         FROM reto.chat_appointment_confirmations
        WHERE id = $1 AND conversation_id = $2 AND requested_by_account_id = $3
        FOR UPDATE`, [confirmationId, conversationId, actorId],
    );
    return rows[0];
  }

  async findTarget(client: PoolClient, appointmentId: string, conversationId: string, clientPath: string, clientRecordId: string) {
    const { rows } = await client.query<AppointmentRow>(
      `SELECT ${appointmentProjection}, last_confirmation_id
         FROM reto.chat_appointments
        WHERE id = $1 AND conversation_id = $2 AND client_document_path = $3
          AND client_record_id = $4 AND status = 'confirmed'
        FOR UPDATE`, [appointmentId, conversationId, clientPath, clientRecordId],
    );
    return rows[0];
  }

  async invalidateConfirmation(client: PoolClient, confirmationId: string) {
    await client.query(
      `UPDATE reto.chat_appointment_confirmations SET status = 'invalidated'
        WHERE id = $1 AND status = 'pending'`, [confirmationId],
    );
  }

  async consumeConfirmation(client: PoolClient, confirmationId: string) {
    await client.query(
      `UPDATE reto.chat_appointment_confirmations SET status = 'consumed', consumed_at = now()
        WHERE id = $1 AND status = 'pending'`, [confirmationId],
    );
  }

  async write(client: PoolClient, confirmation: AppointmentConfirmationRecord, conversationId: string, actorId: string): Promise<AppointmentWriteResult> {
    await client.query("SAVEPOINT appointment_write");
    try {
      const appointment = await this.applyWrite(client, confirmation, conversationId, actorId);
      await client.query("RELEASE SAVEPOINT appointment_write");
      return { state: "written", appointment };
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "23P01") throw error;
      await client.query("ROLLBACK TO SAVEPOINT appointment_write");
      await client.query("RELEASE SAVEPOINT appointment_write");
      return { state: "conflict" };
    }
  }

  private async applyWrite(client: PoolClient, confirmation: AppointmentConfirmationRecord, conversationId: string, actorId: string): Promise<AppointmentRow> {
    if (confirmation.action === "create") {
      const { rows } = await client.query<AppointmentRow>(
        `INSERT INTO reto.chat_appointments(
           conversation_id, client_document_path, client_record_id,
           agent_account_id, created_by_account_id, start_at, end_at,
           time_zone, local_start, start_utc_offset_minutes, last_confirmation_id
         ) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${appointmentProjection}`,
        [conversationId, confirmation.client_document_path, confirmation.client_record_id,
          confirmation.agent_account_id, actorId, confirmation.start_at, confirmation.end_at,
          confirmation.time_zone, confirmation.local_start, confirmation.start_utc_offset_minutes, confirmation.id],
      );
      return rows[0];
    }
    if (confirmation.action === "reschedule") {
      const { rows } = await client.query<AppointmentRow>(
        `UPDATE reto.chat_appointments
            SET agent_account_id = $2, start_at = $3, end_at = $4, time_zone = $5,
                local_start = $6, start_utc_offset_minutes = $7, last_confirmation_id = $8
          WHERE id = $1
          RETURNING ${appointmentProjection}`,
        [confirmation.appointment_id, confirmation.agent_account_id, confirmation.start_at,
          confirmation.end_at, confirmation.time_zone, confirmation.local_start,
          confirmation.start_utc_offset_minutes, confirmation.id],
      );
      return rows[0];
    }
    const { rows } = await client.query<AppointmentRow>(
      `UPDATE reto.chat_appointments
          SET status = 'cancelled', cancelled_at = now(), last_confirmation_id = $2
        WHERE id = $1
        RETURNING ${appointmentProjection}`, [confirmation.appointment_id, confirmation.id],
    );
    return rows[0];
  }
}
