import type { PoolClient } from "pg";
import type { AuthorizedConversation, Principal } from "./authorization.js";
import type { AssistantEvidenceRepository, AssistantEvidenceResult } from "./assistant-evidence-repository.js";
import type { AssistantDraftingPort } from "./assistant-provider.js";

/** Coordinates evidence retrieval and drafting while keeping both dependencies replaceable. */
export class AssistantService {
  constructor(
    private readonly evidence: AssistantEvidenceRepository,
    private readonly drafting: AssistantDraftingPort,
  ) {}

  isEnabled(): boolean {
    return this.drafting.isEnabled();
  }

  loadEvidence(client: PoolClient, conversation: AuthorizedConversation, principal: Principal): Promise<AssistantEvidenceResult> {
    return this.evidence.load(client, conversation, principal);
  }

  draft(evidence: unknown, question: string): Promise<string> {
    return this.drafting.draft(evidence, question);
  }
}
