import type { AppointmentChatScope } from "../domain/appointment-chat.js";
import type { AppointmentChatStateOutcome } from "../domain/appointment-chat-state.js";
import type { AppointmentChatTransactions } from "./appointment-chat-ports.js";
import type { AppointmentChatStateAccess, AppointmentChatStateRepository } from "./appointment-chat-state-ports.js";

export class AppointmentChatStateService {
  constructor(
    private readonly transactions: AppointmentChatTransactions,
    private readonly repository: AppointmentChatStateRepository,
    private readonly access: AppointmentChatStateAccess,
  ) {}

  load(tokenHash: string, conversationId: string) {
    return this.transactions.run<AppointmentChatStateOutcome>(tokenHash, conversationId, async (client, conversation, principal) => {
      const clientPath = conversation.active_client_path;
      const clientRecordId = conversation.active_client_record_id;
      if (conversation.status !== "active" || principal.role !== "agent" || !clientPath || !clientRecordId)
        return { state: "idle" };
      if (!(await this.access.hasClient(client, principal, clientPath, clientRecordId)))
        return { state: "idle" };

      const scope: AppointmentChatScope = {
        conversationId: conversation.id, accountId: principal.accountId, clientPath, clientRecordId,
      };
      const row = await this.repository.findPending(client, scope);
      if (!row) {
        await this.repository.clearStale(client, scope);
        return { state: "idle" };
      }
      if (row.stage === "details") return { state: "details" };
      if (!(await this.access.canManageAgent(client, principal, row.agent_account_id)))
        return { state: "idle" };
      return { state: "confirmation", confirmation: row };
    });
  }
}

export type AppointmentChatStateResult = Awaited<ReturnType<AppointmentChatStateService["load"]>>;
