import type { AuthorizedConversation, Database, Principal } from "../../../shared/auth/authorization-types.js";
import { listAuthorizedConversations } from "./conversation-access-repository.js";
import type { ConversationManagementRepository, ConversationMessage } from "../services/conversation-management-ports.js";

export class PostgresConversationManagementRepository implements ConversationManagementRepository {
  constructor(private readonly readDatabase: Database) {}

  list(principal: Principal, search?: string) {
    return listAuthorizedConversations(this.readDatabase, principal, search);
  }

  async create(db: Database, accountId: string, title: string | null) {
    const { rows } = await db.query<AuthorizedConversation>(
      `INSERT INTO reto.chat_conversations(owner_account_id, title)
       VALUES($1, $2)
       RETURNING id, owner_account_id, title, status, active_client_path,
                 active_client_record_id, created_at, updated_at, archived_at`,
      [accountId, title],
    );

    return rows[0];
  }

  async rename(db: Database, conversationId: string, title: string) {
    const { rows } = await db.query<AuthorizedConversation>(
      `UPDATE reto.chat_conversations
          SET title = $2, updated_at = now()
        WHERE id = $1
        RETURNING id, owner_account_id, title, status, active_client_path,
                  active_client_record_id, created_at, updated_at, archived_at`,
      [conversationId, title],
    );

    return rows[0];
  }

  async listMessages(db: Database, conversation: AuthorizedConversation, beforeSequence: string | null, limit: number) {
    const { rows } = await db.query<ConversationMessage>(
      `SELECT m.id, m.sequence_no, m.sender_role, m.content, m.created_at
         FROM reto.chat_messages AS m
         LEFT JOIN LATERAL (
           SELECT a.entity_id
             FROM reto.chat_actions AS a
            WHERE a.conversation_id = m.conversation_id
              AND a.action_type IN ('client.selected', 'client.changed')
              AND a.outcome = 'succeeded'
              AND a.occurred_at <= m.created_at
            ORDER BY a.occurred_at DESC, a.id DESC
            LIMIT 1
         ) AS context ON true
        WHERE m.conversation_id = $1
          AND (
            ($2::text IS NULL
             AND m.client_document_path IS NULL
             AND m.client_record_id IS NULL
             AND context.entity_id IS NULL)
            OR
            ($2::text IS NOT NULL AND (
              (m.client_document_path = $2 AND m.client_record_id = $3)
              OR (m.client_document_path IS NULL
                  AND m.client_record_id IS NULL
                  AND context.entity_id = $2 || '#' || $3)
            ))
          )
          AND ($4::bigint IS NULL OR m.sequence_no < $4::bigint)
        ORDER BY m.sequence_no DESC
        LIMIT $5`,
      [conversation.id, conversation.active_client_path, conversation.active_client_record_id, beforeSequence, limit + 1],
    );

    return rows;
  }
}
