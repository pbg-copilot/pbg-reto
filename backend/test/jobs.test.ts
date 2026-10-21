import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { db } from "../src/db/kysely.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { backoffSeconds, enqueue } from "../src/jobs/queue.js";
import { createWorker, type Handlers } from "../src/jobs/runner.js";
import { closeDb } from "./helpers.js";

const quiet = { info: () => {}, warn: () => {}, error: () => {} };
// Tipos únicos por ejecución: el worker de compose no los reclama (no tiene handler).
const suffix = randomBytes(4).toString("hex");
const NOOP = `test-noop-${suffix}`;
const FAIL_ONCE = `test-fail-once-${suffix}`;
const ALWAYS_FAIL = `test-always-fail-${suffix}`;

let failOnceCalls = 0;
const finalFailures: string[] = [];
const handlers: Handlers = {
  [NOOP]: { run: async () => {} },
  [FAIL_ONCE]: {
    run: async () => {
      failOnceCalls += 1;
      if (failOnceCalls === 1) throw new Error("temporary failure");
    },
  },
  [ALWAYS_FAIL]: {
    run: async () => {
      throw new Error("permanent failure");
    },
    onFinalFailure: async (job) => {
      finalFailures.push(job.id);
    },
  },
};

const worker = createWorker({ db, handlers, workerId: "test-worker", concurrency: 4, pollMs: 50, log: quiet });
const statusOf = (id: string) =>
  db.selectFrom("helpdesk.jobs").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const makeDue = (id: string) =>
  db.updateTable("helpdesk.jobs").set({ run_at: new Date(Date.now() - 1000) }).where("id", "=", id).execute();

afterAll(async () => {
  await db.deleteFrom("helpdesk.jobs").where("type", "like", `test-%-${suffix}`).execute();
  await closeDb();
});

describe("AC-001.9 persistent jobs", () => {
  it("applies migrations idempotently", async () => {
    await migrateToLatest(db, { info: () => {}, error: () => {} });
    await migrateToLatest(db, { info: () => {}, error: () => {} });
  });

  it("processes a noop job", async () => {
    const job = await enqueue(db, { type: NOOP });
    await worker.runOnce();
    expect((await statusOf(job!.id)).status).toBe("succeeded");
  });

  it("deduplicates jobs by dedupe key", async () => {
    const key = `dedupe-${suffix}`;
    const first = await enqueue(db, { type: NOOP, dedupeKey: key });
    const second = await enqueue(db, { type: NOOP, dedupeKey: key });
    expect(first?.id).toBeDefined();
    expect(second).toBeUndefined();
  });

  it("retries with backoff and then succeeds", async () => {
    const job = await enqueue(db, { type: FAIL_ONCE });
    await worker.runOnce();
    const afterFailure = await statusOf(job!.id);
    expect(afterFailure.status).toBe("queued");
    expect(afterFailure.attempts).toBe(1);
    expect(afterFailure.last_error).toBe("temporary failure");
    expect(afterFailure.run_at.getTime()).toBeGreaterThan(Date.now());
    await makeDue(job!.id);
    await worker.runOnce();
    expect((await statusOf(job!.id)).status).toBe("succeeded");
  });

  it("marks the job failed after max attempts and calls onFinalFailure", async () => {
    const job = await enqueue(db, { type: ALWAYS_FAIL, maxAttempts: 2 });
    await worker.runOnce();
    await makeDue(job!.id);
    await worker.runOnce();
    const final = await statusOf(job!.id);
    expect(final.status).toBe("failed");
    expect(final.attempts).toBe(2);
    expect(finalFailures).toContain(job!.id);
  });

  it("uses exponential backoff capped at 10 minutes", () => {
    expect([1, 2, 3, 20].map(backoffSeconds)).toEqual([10, 20, 40, 600]);
  });
});
