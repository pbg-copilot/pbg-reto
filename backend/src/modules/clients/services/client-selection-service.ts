import type { ClientSelectionInput, ClientSelectionRepository, ClientSelectionTransactions } from "./client-selection-ports.js";

export class ClientSelectionService {
  constructor(
    private readonly transactions: ClientSelectionTransactions,
    private readonly repository: ClientSelectionRepository,
  ) {}

  select(tokenHash: string, conversationId: string, input: ClientSelectionInput) {
    return this.transactions.run(tokenHash, conversationId, async (client, conversation, principal) => {
      if (conversation.status !== "active") return { state: "archived" as const };
      const selected = await this.repository.findClient(client, principal, input.documentPath, input.clientRecordId);
      if (!selected) return { state: "not_found" as const };
      const changed = conversation.active_client_path !== selected.document_path ||
        conversation.active_client_record_id !== selected.client_record_id;
      if (changed) {
        await this.repository.setActiveClient(client, conversation.id, selected);
        await this.repository.recordSelection(
          client, principal, conversation.id,
          conversation.active_client_path ? "client.changed" : "client.selected",
          selected,
        );
      }
      return { state: "selected" as const, changed, client: selected };
    });
  }
}

export type ClientSelectionResult = Awaited<ReturnType<ClientSelectionService["select"]>>;
