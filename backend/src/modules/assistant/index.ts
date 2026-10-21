import type { Env } from "../../config/env.js";
import { createAnthropicProvider } from "./anthropic-provider.js";
import { createFakeProvider } from "./fake-provider.js";
import type { AssistantProvider } from "./provider.js";

// AI_PROVIDER=anthropic usa claude-haiku-5-5; sin key (o AI_PROVIDER=fake) el proveedor simulado.
export const createProvider = (env: Env): AssistantProvider =>
  env.AI_PROVIDER === "anthropic" ? createAnthropicProvider(env) : createFakeProvider(env);
