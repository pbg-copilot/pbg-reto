import type { ChatMessageRepository, ChatMessageTransactions } from "./chat-message-ports.js";

export class ChatMessageService {
  constructor(
    private readonly transactions: ChatMessageTransactions,
    private readonly repository: ChatMessageRepository,
  ) {}

  async create(tokenHash: string, conversationId: string, input: string) {
    const content = input.trim();
    if (!content) return { state: "invalid_content" as const };

    return this.transactions.authorized(tokenHash, conversationId, async (client, conversation) => {
      if (conversation.status !== "active") return { state: "archived" as const };
      const message = await this.repository.save(client, {
        conversationId: conversation.id,
        content,
        clientDocumentPath: conversation.active_client_path,
        clientRecordId: conversation.active_client_record_id,
      });
      return { state: "saved" as const, message };
    });
  }
}

export type CreateChatMessageResult = Awaited<ReturnType<ChatMessageService["create"]>>;
