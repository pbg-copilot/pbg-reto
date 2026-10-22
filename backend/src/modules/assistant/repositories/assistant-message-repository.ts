import type { PoolClient } from "pg";
import type { ConversationMessage } from "../../conversations/services/conversation-management-ports.js";
import type { AssistantExchange, AssistantMessageRepository } from "../services/assistant-conversation-ports.js";

export class PostgresAssistantMessageRepository implements AssistantMessageRepository {
  async saveExchange(client: PoolClient, exchange: AssistantExchange): Promise<ConversationMessage[]> {
    const messages: ConversationMessage[] = [];
    for (const [role, content] of [
      ["user", exchange.question],
      ["assistant", exchange.answer],
    ] as const) {
      const result = await client.query<ConversationMessage>(
        `INSERT INTO reto.chat_messages(
           conversation_id, sender_role, content,
           client_document_path, client_record_id
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, sequence_no, sender_role, content, created_at`,
        [exchange.conversationId, role, content, exchange.clientDocumentPath, exchange.clientRecordId],
      );
      messages.push(result.rows[0]);
    }
    await client.query("UPDATE reto.chat_conversations SET updated_at = now() WHERE id = $1", [exchange.conversationId]);
    return messages;
  }
}
