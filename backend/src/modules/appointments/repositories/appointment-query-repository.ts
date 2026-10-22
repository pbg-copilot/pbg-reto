import type { Database } from "../../../shared/auth/authorization-types.js";
import type { AppointmentRow } from "../domain/appointment-model.js";
import type { AppointmentQueryRepository } from "../services/appointment-query-ports.js";

export class PostgresAppointmentQueryRepository implements AppointmentQueryRepository {
  async listConfirmed(db: Database, clientPath: string, clientRecordId: string): Promise<AppointmentRow[]> {
    const { rows } = await db.query<AppointmentRow>(
      `SELECT id, conversation_id, client_document_path,
              client_record_id, agent_account_id, start_at, end_at,
              time_zone,
              to_char(local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
              start_utc_offset_minutes, status
         FROM reto.chat_appointments
        WHERE client_document_path = $1
          AND client_record_id = $2
          AND status = 'confirmed'
        ORDER BY start_at, id`,
      [clientPath, clientRecordId],
    );
    return rows;
  }
}
