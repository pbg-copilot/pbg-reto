import type { Database } from "../../../shared/auth/authorization-types.js";
import type { ConversationMessage } from "../../conversations/services/conversation-management-ports.js";
import type { AppointmentChatConfirmation, AppointmentChatScope, AppointmentChatSummary } from "../domain/appointment-chat.js";
import type { AppointmentChatRepository } from "../services/appointment-chat-ports.js";

export class PostgresAppointmentChatRepository implements AppointmentChatRepository {
  async findAgentName(db: Database, accountId: string) {
    const result = await db.query<{ name: string | null }>(
      `SELECT NULLIF(trim(concat_ws(' ', first_name, middle_name, last_name)), '') AS name
         FROM onboarding.profiles WHERE account_id = $1`,
      [accountId],
    );
    return result.rows[0]?.name ?? null;
  }

  async hasRecentConflict(db: Database, scope: AppointmentChatScope) {
    const result = await db.query(
      `SELECT 1 FROM reto.chat_actions
        WHERE conversation_id = $1 AND actor_account_id = $2
          AND action_type = 'appointment.created'
          AND outcome = 'conflict' AND error_code = 'slot_taken'
          AND occurred_at >= now() - interval '5 minutes'
        LIMIT 1`,
      [scope.conversationId, scope.accountId],
    );
    return result.rows.length > 0;
  }

  async findConfirmation(db: Database, scope: AppointmentChatScope, confirmationId: string) {
    const result = await db.query<AppointmentChatConfirmation>(
      `SELECT action, agent_account_id,
              to_char(local_start, 'DD/MM/YYYY') AS local_date,
              to_char(local_start, 'HH24:MI') AS local_time,
              time_zone,
              start_utc_offset_minutes,
              extract(epoch FROM (end_at - start_at))::int / 60 AS duration_minutes
         FROM reto.chat_appointment_confirmations
        WHERE id = $1 AND conversation_id = $2
          AND requested_by_account_id = $3
          AND client_document_path = $4 AND client_record_id = $5
          AND status = 'pending' AND expires_at > now()`,
      [confirmationId, scope.conversationId, scope.accountId, scope.clientPath, scope.clientRecordId],
    );
    return result.rows[0];
  }

  async findCreatedAppointment(db: Database, scope: AppointmentChatScope, appointmentId: string) {
    const result = await db.query<AppointmentChatSummary>(
      `SELECT to_char(a.local_start, 'DD/MM/YYYY') AS local_date,
              to_char(a.local_start, 'HH24:MI') AS local_time,
              a.start_utc_offset_minutes, a.time_zone, a.agent_account_id,
              extract(epoch FROM (a.end_at - a.start_at))::int / 60 AS duration_minutes
         FROM reto.chat_appointments AS a
         JOIN reto.chat_actions AS action
           ON action.conversation_id = a.conversation_id
          AND action.actor_account_id = $4
          AND action.action_type = 'appointment.created'
          AND action.outcome = 'succeeded'
          AND action.entity_id = a.id::text
        WHERE a.id = $1 AND a.conversation_id = $2
          AND a.client_document_path = $3 AND a.client_record_id = $5
          AND a.status = 'confirmed'
        ORDER BY action.occurred_at DESC LIMIT 1`,
      [appointmentId, scope.conversationId, scope.clientPath, scope.accountId, scope.clientRecordId],
    );
    return result.rows[0];
  }

  async listAppointments(db: Database, scope: AppointmentChatScope) {
    const result = await db.query<AppointmentChatSummary>(
      `SELECT id, agent_account_id,
              to_char(local_start, 'DD/MM/YYYY') AS local_date,
              to_char(local_start, 'HH24:MI') AS local_time,
              start_utc_offset_minutes, time_zone,
              extract(epoch FROM (end_at - start_at))::int / 60 AS duration_minutes
         FROM reto.chat_appointments
        WHERE client_document_path = $1
          AND client_record_id = $2
          AND status = 'confirmed'
        ORDER BY start_at, id`,
      [scope.clientPath, scope.clientRecordId],
    );
    return result.rows;
  }

  async saveDetailsState(db: Database, scope: AppointmentChatScope) {
    await db.query(
      `INSERT INTO reto.chat_appointment_chat_state(
         conversation_id, requested_by_account_id, client_document_path,
         client_record_id, stage, confirmation_id, updated_at
       ) VALUES ($1, $2, $3, $4, 'details', NULL, now())
       ON CONFLICT (conversation_id) DO UPDATE SET
         requested_by_account_id = excluded.requested_by_account_id,
         client_document_path = excluded.client_document_path,
         client_record_id = excluded.client_record_id,
         stage = 'details', confirmation_id = NULL, updated_at = now()`,
      [scope.conversationId, scope.accountId, scope.clientPath, scope.clientRecordId],
    );
  }

  async saveConfirmationState(db: Database, scope: AppointmentChatScope, confirmationId: string) {
    await db.query(
      `INSERT INTO reto.chat_appointment_chat_state(
         conversation_id, requested_by_account_id, client_document_path,
         client_record_id, stage, confirmation_id, updated_at
       ) VALUES ($1, $2, $3, $4, 'confirmation', $5, now())
       ON CONFLICT (conversation_id) DO UPDATE SET
         requested_by_account_id = excluded.requested_by_account_id,
         client_document_path = excluded.client_document_path,
         client_record_id = excluded.client_record_id,
         stage = 'confirmation', confirmation_id = excluded.confirmation_id,
         updated_at = now()`,
      [scope.conversationId, scope.accountId, scope.clientPath, scope.clientRecordId, confirmationId],
    );
  }

  async clearState(db: Database, scope: AppointmentChatScope) {
    await db.query(
      `DELETE FROM reto.chat_appointment_chat_state
        WHERE conversation_id = $1 AND requested_by_account_id = $2`,
      [scope.conversationId, scope.accountId],
    );
  }

  async saveTurn(db: Database, scope: AppointmentChatScope, content: string, response: string) {
    const userMessage = await db.query<ConversationMessage>(
      `INSERT INTO reto.chat_messages(conversation_id, sender_role, content, client_document_path, client_record_id)
       VALUES ($1, 'user', $2, $3, $4)
       RETURNING id, sequence_no, sender_role, content, created_at`,
      [scope.conversationId, content, scope.clientPath, scope.clientRecordId],
    );
    const assistantMessage = await db.query<ConversationMessage>(
      `INSERT INTO reto.chat_messages(conversation_id, sender_role, content, client_document_path, client_record_id)
      VALUES ($1, 'assistant', $2, $3, $4)
       RETURNING id, sequence_no, sender_role, content, created_at`,
      [scope.conversationId, response, scope.clientPath, scope.clientRecordId],
    );
    await db.query("UPDATE reto.chat_conversations SET updated_at = now() WHERE id = $1", [scope.conversationId]);
    return [userMessage.rows[0], assistantMessage.rows[0]];
  }
}
