import type Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompt.js";
import { AssistantUnavailableError, type AssistantProvider, type ProviderUsage } from "./provider.js";
import { executeTool, TOOLS, type ToolContext } from "./tools.js";

// Un turno del asistente: llamada → herramientas → llamada… hasta end_turn.
// No persiste nada: devuelve los mensajes nuevos (append-only) para que el servicio los guarde.

export type NewMessage = {
  role: "user" | "assistant";
  kind: "message" | "tool_result";
  content: Anthropic.ContentBlockParam[] | Anthropic.ContentBlock[];
};

export type TurnOutput = {
  messages: NewMessage[];
  text: string;
  usage: ProviderUsage & { calls: number };
  model: string;
};

const TURN_BUDGET_MS = 45_000;

export async function runTurn(options: {
  provider: AssistantProvider;
  history: Anthropic.MessageParam[];
  ctx: ToolContext;
  maxIterations: number;
  callTimeoutMs: number;
}): Promise<TurnOutput> {
  const { provider, ctx, maxIterations, callTimeoutMs } = options;
  const messages: Anthropic.MessageParam[] = [...options.history];
  const created: NewMessage[] = [];
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, calls: 0 };
  const deadline = Date.now() + TURN_BUDGET_MS;
  let model: string;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new AssistantUnavailableError("timeout", "turn budget");
    const response = await provider.complete({
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
      signal: AbortSignal.timeout(Math.min(callTimeoutMs, remaining)),
    });
    model = response.model;
    usage.calls += 1;
    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    usage.cache_read_input_tokens += response.usage.cache_read_input_tokens;
    usage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens;

    // El contenido del asistente se guarda tal cual, incluidos los bloques thinking.
    messages.push({ role: "assistant", content: response.content });
    created.push({ role: "assistant", kind: "message", content: response.content });

    // Los bloques se leen por type, nunca por posición.
    const toolUses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
    if (response.stop_reason === "tool_use" && toolUses.length > 0) {
      // Todas las herramientas del turno, y todos los resultados en un solo mensaje user.
      const results = await Promise.all(toolUses.map((use) => executeTool(use.name, use.input, ctx)));
      const toolResults: Anthropic.ToolResultBlockParam[] = toolUses.map((use, index) => ({
        type: "tool_result",
        tool_use_id: use.id,
        content: results[index]!.content,
        ...(results[index]!.isError ? { is_error: true } : {}),
      }));
      messages.push({ role: "user", content: toolResults });
      created.push({ role: "user", kind: "tool_result", content: toolResults });
      continue;
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    return { messages: created, text, usage, model };
  }
  throw new AssistantUnavailableError("iterations");
}
