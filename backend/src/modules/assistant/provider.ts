import type Anthropic from "@anthropic-ai/sdk";

export type ProviderRequest = {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  signal: AbortSignal;
};

export type ProviderUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export type ProviderResponse = {
  content: Anthropic.ContentBlock[];
  stop_reason: Anthropic.StopReason | null;
  usage: ProviderUsage;
  model: string;
};

export interface AssistantProvider {
  readonly name: "anthropic" | "fake";
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

export type UnavailableReason = "timeout" | "provider_error" | "rate_limited" | "refusal" | "max_tokens" | "iterations";

// Cualquier falla del modelo termina aquí: el servicio responde 503 y ofrece el formulario.
export class AssistantUnavailableError extends Error {
  constructor(
    readonly reason: UnavailableReason,
    detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "AssistantUnavailableError";
  }
}
