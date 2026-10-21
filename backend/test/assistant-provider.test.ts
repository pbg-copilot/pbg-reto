import Anthropic from "@anthropic-ai/sdk";
import { afterAll, describe, expect, it } from "vitest";
import { createAnthropicProvider } from "../src/modules/assistant/anthropic-provider.js";
import { createFakeProvider } from "../src/modules/assistant/fake-provider.js";
import {
  AssistantUnavailableError,
  type AssistantProvider,
  type ProviderRequest,
} from "../src/modules/assistant/provider.js";

import { db } from "../src/db/kysely.js";
import { buildTestApp, closeDb, loginAs, testEnv, TEST_USERS, uniqueKey } from "./helpers.js";

const request: ProviderRequest = {
  system: "s",
  tools: [],
  messages: [{ role: "user", content: "hola" }],
  signal: AbortSignal.timeout(1000),
};
const clientReturning = (create: () => Promise<unknown>) =>
  ({ messages: { create } }) as unknown as Pick<Anthropic, "messages">;
const reasonOf = async (provider: AssistantProvider) => {
  try {
    await provider.complete(request);
    return "ok";
  } catch (error) {
    return error instanceof AssistantUnavailableError
      ? error.reason
      : `unexpected: ${String(error)}`;
  }
};

describe("T004.4 Anthropic provider maps failures to AssistantUnavailableError", () => {
  const env = { ...testEnv(), AI_PROVIDER: "anthropic" as const, ANTHROPIC_API_KEY: "test" };
  const response = (stop_reason: string) =>
    Promise.resolve({
      content: [],
      stop_reason,
      model: "claude-haiku-5-5",
      usage: { input_tokens: 1, output_tokens: 1 },
    });

  it("treats refusal and max_tokens as unavailable (stop_reason is checked before content)", async () => {
    expect(
      await reasonOf(
        createAnthropicProvider(
          env,
          clientReturning(() => response("refusal")),
        ),
      ),
    ).toBe("refusal");
    expect(
      await reasonOf(
        createAnthropicProvider(
          env,
          clientReturning(() => response("max_tokens")),
        ),
      ),
    ).toBe("max_tokens");
    expect(
      await reasonOf(
        createAnthropicProvider(
          env,
          clientReturning(() => response("end_turn")),
        ),
      ),
    ).toBe("ok");
  });

  it("maps typed SDK errors: timeout and connection", async () => {
    const timeout = clientReturning(() =>
      Promise.reject(new Anthropic.APIConnectionTimeoutError()),
    );
    const connection = clientReturning(() =>
      Promise.reject(new Anthropic.APIConnectionError({ message: "down" })),
    );
    expect(await reasonOf(createAnthropicProvider(env, timeout))).toBe("timeout");
    expect(await reasonOf(createAnthropicProvider(env, connection))).toBe("provider_error");
  });
});

// T004.8: el historial que se reenvía al modelo es exactamente lo que el modelo devolvió
// (append-only, sin editar turnos ni quitar bloques).
describe("T004.8 append-only history", () => {
  const calls: { messages: Anthropic.MessageParam[]; response: Anthropic.ContentBlock[] }[] = [];
  const fake = createFakeProvider(testEnv());
  const spy: AssistantProvider = {
    name: "fake",
    async complete(req) {
      const result = await fake.complete(req);
      calls.push({ messages: structuredClone(req.messages), response: result.content });
      return result;
    },
  };
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let actor: { id: string; headers: Record<string, string> };

  afterAll(async () => {
    await db.deleteFrom("helpdesk.conversations").where("requester_id", "=", actor.id).execute();
    await app.close();
    await closeDb();
  });

  it("replays every stored block unchanged on the next turn", async () => {
    app = await buildTestApp(undefined, { provider: spy });
    actor = await loginAs(TEST_USERS.requester);
    const post = (url: string, payload?: object) =>
      app.inject({
        method: "POST",
        url,
        headers: { ...actor.headers, "idempotency-key": uniqueKey() },
        payload,
      });
    const id = (await post("/support/conversations")).json().id;
    await post(`/support/conversations/${id}/messages`, { text: "La sesión se cierra sola" });
    const firstTurnCalls = calls.length;
    await post(`/support/conversations/${id}/messages`, {
      text: "Gracias, otra duda: Zxqv qwerty",
    });

    const lastFirstTurn = calls[firstTurnCalls - 1]!;
    const replayed = calls[firstTurnCalls]!.messages;
    // Todo lo que vio la última llamada del turno 1, más su respuesta, se reenvía idéntico.
    const expected = [
      ...lastFirstTurn.messages,
      { role: "assistant", content: lastFirstTurn.response },
    ];
    expect(replayed.slice(0, expected.length)).toEqual(expected);
    expect(replayed.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "Gracias, otra duda: Zxqv qwerty" }],
    });
  });
});
