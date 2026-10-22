import type { Database } from "../../../shared/auth/authorization-types.js";
import type { AppointmentChatScope } from "../domain/appointment-chat.js";
import type { AppointmentChatStateRow } from "../domain/appointment-chat-state.js";
import type { AppointmentChatStateRepository } from "../services/appointment-chat-state-ports.js";

export class PostgresAppointmentChatStateRepository implements AppointmentChatStateRepository {
  async findPending(db: Database, scope: AppointmentChatScope): Promise<AppointmentChatStateRow | undefined> {
    const { rows } = await db.query<AppointmentChatStateRow>(
      `SELECT s.stage, c.id, c.expires_at, c.action, c.appointment_id,
              c.client_document_path, c.client_record_id, c.agent_account_id,
              c.start_at, c.end_at, c.time_zone,
              to_char(c.local_start, 'YYYY-MM-DD"T"HH24:MI:SS') AS local_start,
              c.start_utc_offset_minutes
         FROM reto.chat_appointment_chat_state AS s
         LEFT JOIN reto.chat_appointment_confirmations AS c
           ON c.id = s.confirmation_id AND c.status = 'pending' AND c.expires_at > now()
        WHERE (s.conversation_id = $1 AND s.requested_by_account_id = $2
          AND s.client_document_path = $3 AND s.client_record_id = $4
          AND s.stage = 'details') OR (
            s.conversation_id = $1 AND s.requested_by_account_id = $2
            AND s.client_document_path = $3 AND s.client_record_id = $4
            AND s.stage = 'confirmation' AND c.id IS NOT NULL
          )
        LIMIT 1`,
      [scope.conversationId, scope.accountId, scope.clientPath, scope.clientRecordId],
    );
    return rows[0];
  }

  async clearStale(db: Database, scope: AppointmentChatScope): Promise<void> {
    await db.query(
      `DELETE FROM reto.chat_appointment_chat_state
        WHERE conversation_id = $1 AND requested_by_account_id = $2
          AND (client_document_path <> $3 OR client_record_id <> $4
               OR stage = 'confirmation')`,
      [scope.conversationId, scope.accountId, scope.clientPath, scope.clientRecordId],
    );
  }
}
