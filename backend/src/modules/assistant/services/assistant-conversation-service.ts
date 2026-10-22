import type { AssistantEvidence } from "../repositories/assistant-evidence-repository.js";
import type { ConversationMessage } from "../../conversations/services/conversation-management-ports.js";
import type { AssistantConversationPort, AssistantConversationTransactions, AssistantMessageRepository } from "./assistant-conversation-ports.js";

type FailureState =
  | "invalid_request" | "unavailable" | "unauthorized" | "session_expired"
  | "not_found" | "archived" | "client_not_selected" | "context_changed" | "provider_error";
type Failure = { state: FailureState };
type EvidenceRead = AssistantEvidence | Failure;
export type AssistantConversationResult = Failure | { state: "saved"; messages: ConversationMessage[] };

export class AssistantConversationService {
  constructor(
    private readonly transactions: AssistantConversationTransactions,
    private readonly assistant: AssistantConversationPort,
    private readonly messages: AssistantMessageRepository,
  ) {}

  async respond(tokenHash: string, conversationId: string, input: string): Promise<AssistantConversationResult> {
    const content = input.trim();
    if (!content) return { state: "invalid_request" };
    if (!this.assistant.isEnabled()) return { state: "unavailable" };

    const initial = await this.readEvidence(tokenHash, conversationId, false);
    if (initial.state !== "ready") return initial;

    // Refresh authorization and evidence immediately before sharing data with the provider.
    const fresh = await this.readEvidence(tokenHash, conversationId, true);
    if (fresh.state !== "ready") return fresh;
    if (fresh.client.document_path !== initial.client.document_path || fresh.client.id !== initial.client.id)
      return { state: "context_changed" };

    let answer: string;
    try {
      answer = await this.assistant.draft(fresh, content);
    } catch {
      return { state: "provider_error" };
    }

    // The provider runs outside the transaction; recheck context before persisting either message.
    const saved = await this.transactions.run(tokenHash, conversationId, async (client, conversation) => {
      if (conversation.status !== "active") return { state: "archived" } as const;
      if (conversation.active_client_path !== fresh.client.document_path || conversation.active_client_record_id !== fresh.client.id)
        return { state: "context_changed" } as const;
      const messages = await this.messages.saveExchange(client, {
        conversationId: conversation.id,
        clientDocumentPath: fresh.client.document_path,
        clientRecordId: fresh.client.id,
        question: content,
        answer,
      });
      return { state: "saved", messages } as const;
    });
    if (!saved.authenticated) return { state: "session_expired" };
    if (!saved.authorized) return { state: "not_found" };
    return saved.result;
  }

  private async readEvidence(tokenHash: string, conversationId: string, refresh: boolean): Promise<EvidenceRead> {
    const result = await this.transactions.run(tokenHash, conversationId, async (client, conversation, principal) => {
      if (conversation.status !== "active") return { state: "archived" } as const;
      return this.assistant.loadEvidence(client, conversation, principal);
    });
    if (!result.authenticated) return { state: refresh ? "session_expired" : "unauthorized" };
    if (!result.authorized) return { state: "not_found" };
    return result.result;
  }
}
