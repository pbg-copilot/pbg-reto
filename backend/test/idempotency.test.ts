import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { App } from "../src/app.js";
import { db } from "../src/db/kysely.js";
import { buildTestApp, closeDb, loginAs, TEST_USERS, uniqueKey } from "./helpers.js";

let app: App;
let calls = 0;
let failNext = false;

beforeAll(async () => {
  app = await buildTestApp((instance) => {
    instance.post(
      "/__test/create",
      {
        preHandler: [instance.requireAuth, instance.idempotent],
        schema: { body: z.object({ value: z.string() }) },
      },
      async (request, reply) => {
        calls += 1;
        if (failNext) {
          failNext = false;
          throw new Error("boom");
        }
        return reply.code(201).send({ call: calls, value: (request.body as { value: string }).value });
      },
    );
  });
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

const post = (key: string | undefined, value: string, headers: Record<string, string>) =>
  app.inject({
    method: "POST",
    url: "/__test/create",
    headers: { ...headers, ...(key ? { "idempotency-key": key } : {}) },
    payload: { value },
  });

describe("Idempotency-Key", () => {
  it("replays the stored response for the same key and body", async () => {
    const { headers } = await loginAs(TEST_USERS.requester);
    const key = uniqueKey();
    const first = await post(key, "a", headers);
    const second = await post(key, "a", headers);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(second.headers["idempotent-replayed"]).toBe("true");
  });

  it("rejects the same key with a different body", async () => {
    const { headers } = await loginAs(TEST_USERS.requester);
    const key = uniqueKey();
    await post(key, "a", headers);
    const res = await post(key, "b", headers);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe("idempotency_key_reused");
  });

  it("returns 409 while the same key is still in progress", async () => {
    const { id, headers } = await loginAs(TEST_USERS.requester);
    const key = uniqueKey();
    await post(key, "a", headers);
    await db
      .updateTable("helpdesk.idempotency_keys")
      .set({ status: "in_progress", created_at: new Date() })
      .where("account_id", "=", id)
      .where("key", "=", key)
      .execute();
    const res = await post(key, "a", headers);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("idempotency_in_progress");
  });

  it("does not store 5xx responses so the client can retry", async () => {
    const { headers } = await loginAs(TEST_USERS.requester);
    const key = uniqueKey();
    failNext = true;
    const failed = await post(key, "a", headers);
    expect(failed.statusCode).toBe(500);
    const retried = await post(key, "a", headers);
    expect(retried.statusCode).toBe(201);
    expect(retried.headers["idempotent-replayed"]).toBeUndefined();
  });

  it("scopes keys per account and requires the header", async () => {
    const a = await loginAs(TEST_USERS.requester);
    const b = await loginAs(TEST_USERS.otherRequester);
    const key = uniqueKey();
    const first = await post(key, "a", a.headers);
    const other = await post(key, "a", b.headers);
    expect(other.json().call).not.toBe(first.json().call);
    const missing = await post(undefined, "a", a.headers);
    expect(missing.statusCode).toBe(400);
  });
});
