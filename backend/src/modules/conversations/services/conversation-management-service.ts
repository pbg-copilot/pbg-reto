import type { Principal } from "../../../shared/auth/authorization-types.js";
import type { ConversationHistory, ConversationManagementRepository, ConversationManagementTransactions } from "./conversation-management-ports.js";

export class ConversationManagementService {
  constructor(
    private readonly transactions: ConversationManagementTransactions,
    private readonly repository: ConversationManagementRepository,
  ) {}

  list(principal: Principal, search?: string) {
    return this.repository.list(principal, search?.trim() || undefined);
  }

  create(tokenHash: string, title?: string) {
    return this.transactions.authenticated(tokenHash, (client, principal) =>
      this.repository.create(client, principal.accountId, title?.trim() || null));
  }

  async rename(tokenHash: string, conversationId: string, requestedTitle: string) {
    const title = requestedTitle.trim();
    if (!title) return { state: "invalid_title" as const };
    return this.transactions.owned(tokenHash, conversationId, (client, conversation) =>
      this.repository.rename(client, conversation.id, title));
  }

  async history(tokenHash: string, conversationId: string, limit = 50, beforeSequence: string | null = null) {
    if (beforeSequence !== null && BigInt(beforeSequence) > 9223372036854775807n)
      return { state: "invalid_cursor" as const };
    return this.transactions.authorized<ConversationHistory>(tokenHash, conversationId, async (client, conversation) => {
      const rows = await this.repository.listMessages(client, conversation, beforeSequence, limit);
      const hasMore = rows.length > limit;
      const messages = rows.slice(0, limit).reverse();
      return {
        conversation, messages,
        pagination: { limit, hasMore, nextBeforeSequence: hasMore ? messages[0].sequence_no : null },
      };
    });
  }
}

export type CreateConversationResult = Awaited<ReturnType<ConversationManagementService["create"]>>;
export type RenameConversationResult = Awaited<ReturnType<ConversationManagementService["rename"]>>;
export type ConversationHistoryResult = Awaited<ReturnType<ConversationManagementService["history"]>>;
