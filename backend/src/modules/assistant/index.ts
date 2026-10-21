import type { Env } from "../../config/env.js";
import { createAnthropicProvider } from "./anthropic-provider.js";
import { createFakeProvider } from "./fake-provider.js";
import { AssistantUnavailableError, type AssistantProvider } from "./provider.js";

// AI_PROVIDER=anthropic usa claude-haiku-5-5; sin key (o AI_PROVIDER=fake) el proveedor simulado.
// AI_FAKE_FAILURE=true simula la caída del modelo con cualquier proveedor (demo D6).
export function createProvider(env: Env): AssistantProvider {
  const provider = env.AI_PROVIDER === "anthropic" ? createAnthropicProvider(env) : createFakeProvider(env);
  if (!env.AI_FAKE_FAILURE) return provider;
  return {
    name: provider.name,
    complete: () => Promise.reject(new AssistantUnavailableError("provider_error", "AI_FAKE_FAILURE")),
  };
}
