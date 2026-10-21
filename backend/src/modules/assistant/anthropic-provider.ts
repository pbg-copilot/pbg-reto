import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../../config/env.js";
import { AssistantUnavailableError, type AssistantProvider } from "./provider.js";

// Proveedor real: claude-haiku-5-5 (ADR 0003).
// - Sin temperature/top_p/top_k ni prefill (Haiku 5.5 los rechaza).
// - Thinking adaptativo por defecto; profundidad con output_config.effort = "low" para el chat.
// - tool_choice "auto" y herramientas con strict: true.
// - El bloque de system se cachea (prefijo estable: tools + system).
// El cliente se puede inyectar en los tests (sin red).
type MessagesClient = Pick<Anthropic, "messages">;

// Haiku 5.5 verifica que cada bloque thinking se reenvíe en la misma conversación que lo
// produjo. Si cambian el system prompt o las herramientas (un deploy), los bloques guardados de
// conversaciones anteriores dejan de valer y la API responde 400. Recuperación documentada:
// reintentar una vez sin los bloques thinking (el texto y las herramientas se conservan).
const PREFIX_MISMATCH = /bound to a different conversation/i;
export const isThinkingPrefixMismatch = (error: unknown) =>
  error instanceof Anthropic.BadRequestError && PREFIX_MISMATCH.test(error.message);

export function stripThinking(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return messages.map((message) =>
    message.role !== "assistant" || typeof message.content === "string"
      ? message
      : { ...message, content: message.content.filter((block) => block.type !== "thinking" && block.type !== "redacted_thinking") },
  );
}

export function createAnthropicProvider(env: Env, injected?: MessagesClient): AssistantProvider {
  const client: MessagesClient =
    injected ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: env.AI_TIMEOUT_MS });

  return {
    name: "anthropic",
    async complete({ system, tools, messages, signal }) {
      const send = (history: Anthropic.MessageParam[]) =>
        client.messages.create(
          {
            model: env.AI_MODEL,
            max_tokens: 4096,
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            tools,
            tool_choice: { type: "auto" },
            output_config: { effort: "low" },
            messages: history,
          },
          { signal },
        );
      try {
        let response;
        try {
          response = await send(messages);
        } catch (error) {
          if (!isThinkingPrefixMismatch(error)) throw error;
          response = await send(stripThinking(messages));
        }
        // Revisar stop_reason antes de leer el contenido.
        if (response.stop_reason === "refusal") throw new AssistantUnavailableError("refusal");
        if (response.stop_reason === "max_tokens") throw new AssistantUnavailableError("max_tokens");
        return {
          content: response.content,
          stop_reason: response.stop_reason,
          model: response.model,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
            cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
          },
        };
      } catch (error) {
        if (error instanceof AssistantUnavailableError) throw error;
        // Errores tipados del SDK, del más específico al más general.
        if (error instanceof Anthropic.APIConnectionTimeoutError) throw new AssistantUnavailableError("timeout");
        if (error instanceof Anthropic.RateLimitError) throw new AssistantUnavailableError("rate_limited");
        if (error instanceof Anthropic.APIConnectionError) throw new AssistantUnavailableError("provider_error", "connection");
        if (error instanceof Anthropic.APIError) throw new AssistantUnavailableError("provider_error", `status ${error.status}`);
        if ((error as Error).name === "AbortError") throw new AssistantUnavailableError("timeout");
        throw error;
      }
    },
  };
}
