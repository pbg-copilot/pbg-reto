import type { CreateFollowUpInput, FollowUpExpectedClient } from "../domain/follow-up-model.js";
import type { FollowUpAccess, FollowUpRepository, FollowUpTransactions } from "./follow-up-ports.js";

export class FollowUpService {
  constructor(
    private readonly transactions: FollowUpTransactions,
    private readonly repository: FollowUpRepository,
    private readonly access: FollowUpAccess,
  ) {}

  list(tokenHash: string, conversationId: string) {
    return this.transactions.run(tokenHash, conversationId,
      async (client, conversation, principal) => {
        if (!conversation.active_client_path || !conversation.active_client_record_id)
          return { state: "client_not_selected" as const };
        const profile = await this.access.getProfile(
          client, principal, conversation.active_client_path, conversation.active_client_record_id,
        );
        if (!profile) return { state: "client_not_found" as const };
        const items = await this.repository.listPending(
          client, principal.accountId, conversation.active_client_path, conversation.active_client_record_id,
        );
        return { state: "loaded" as const, clientName: profile.name, followUps: items };
      },
    );
  }

  async create(tokenHash: string, conversationId: string, body: CreateFollowUpInput) {
    const description = body.description.trim();
    if (!description) return { state: "empty_description" as const };
    return this.transactions.run(tokenHash, conversationId,
      async (client, conversation, principal) => {
        if (principal.role !== "agent") return { state: "forbidden" as const };
        if (conversation.status !== "active") return { state: "conversation_archived" as const };
        if (!conversation.active_client_path || !conversation.active_client_record_id)
          return { state: "client_not_selected" as const };
        if (conversation.active_client_path !== body.expectedClientPath ||
            conversation.active_client_record_id !== body.expectedClientRecordId)
          return { state: "context_changed" as const };
        const profile = await this.access.getProfile(
          client, principal, conversation.active_client_path, conversation.active_client_record_id,
        );
        if (!profile) return { state: "client_not_found" as const };
        const followUp = await this.repository.create(client, {
          conversationId: conversation.id,
          clientPath: conversation.active_client_path,
          clientRecordId: conversation.active_client_record_id,
          actorId: principal.accountId,
          description,
          dueDate: body.dueDate,
        });
        if (!followUp) return { state: "past_date" as const };
        await this.repository.recordAction(client, conversation.id, principal, "follow_up.created", followUp.id);
        return { state: "created" as const, followUp, clientName: profile.name };
      },
    );
  }

  complete(tokenHash: string, conversationId: string, followUpId: string, body: FollowUpExpectedClient) {
    return this.transactions.run(tokenHash, conversationId,
      async (client, conversation, principal) => {
        if (principal.role !== "agent") return { state: "forbidden" as const };
        if (!conversation.active_client_path || !conversation.active_client_record_id)
          return { state: "client_not_selected" as const };
        if (conversation.active_client_path !== body.expectedClientPath ||
            conversation.active_client_record_id !== body.expectedClientRecordId)
          return { state: "context_changed" as const };
        const followUp = await this.repository.complete(
          client, principal.accountId, conversation.active_client_path, conversation.active_client_record_id, followUpId,
        );
        if (!followUp) return { state: "not_found" as const };
        await this.repository.recordAction(client, conversation.id, principal, "follow_up.completed", followUp.id);
        return { state: "completed" as const, followUp };
      },
    );
  }
}

export type ListFollowUpsResult = Awaited<ReturnType<FollowUpService["list"]>>;
export type CreateFollowUpResult = Awaited<ReturnType<FollowUpService["create"]>>;
export type CompleteFollowUpResult = Awaited<ReturnType<FollowUpService["complete"]>>;
