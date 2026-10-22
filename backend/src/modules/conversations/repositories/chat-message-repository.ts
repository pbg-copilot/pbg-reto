import type { Database } from "../../../shared/auth/authorization-types.js";
import type { ChatMessageRepository, NewChatMessage } from "../services/chat-message-ports.js";
import type { ConversationMessage } from "../services/conversation-management-ports.js";

export class PostgresChatMessageRepository implements ChatMessageRepository {
  async save(db: Database, message: NewChatMessage): Promise<ConversationMessage> {
    const { rows } = await db.query<ConversationMessage>(
      `INSERT INTO reto.chat_messages(
         conversation_id, sender_role, content,
         client_document_path, client_record_id
       )
       VALUES($1, 'user', $2, $3, $4)
       RETURNING id, sequence_no, sender_role, content, created_at`,
      [message.conversationId, message.content, message.clientDocumentPath, message.clientRecordId],
    );
    await db.query(
      "UPDATE reto.chat_conversations SET updated_at = now() WHERE id = $1",
      [message.conversationId],
    );
    return rows[0];
  }
}
