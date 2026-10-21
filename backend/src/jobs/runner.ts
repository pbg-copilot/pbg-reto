import { writeFile } from "node:fs/promises";
import type { Kysely } from "kysely";
import type { DB, Job } from "../db/types.js";
import { claimJobs, completeJob, failJob, recoverStaleJobs } from "./queue.js";

export type JobHandler = {
  run: (job: Job) => Promise<void>;
  // Se llama cuando se agotan los reintentos (por ejemplo, marcar una entrega como fallida).
  onFinalFailure?: (job: Job, error: unknown) => Promise<void>;
};

export type Handlers = Record<string, JobHandler>;

type Log = {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
};

type Options = {
  db: Kysely<DB>;
  handlers: Handlers;
  workerId: string;
  concurrency: number;
  pollMs: number;
  log: Log;
  heartbeatFile?: string;
};

export function createWorker({ db, handlers, workerId, concurrency, pollMs, log, heartbeatFile }: Options) {
  let running = false;
  let current: Promise<void> | null = null;
  let lastRecovery = 0;

  async function process(job: Job) {
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`Unknown job type: ${job.type}`);
      await handler.run(job);
      await completeJob(db, job.id);
    } catch (error) {
      const outcome = await failJob(db, job, error);
      log.warn({ jobId: job.id, type: job.type, attempts: job.attempts, outcome }, "job failed");
      if (outcome === "failed") await handler?.onFinalFailure?.(job, error);
    }
  }

  // Procesa un lote. Devuelve cuántos jobs tomó (lo usan los tests).
  async function runOnce(): Promise<number> {
    if (Date.now() - lastRecovery > 30_000) {
      lastRecovery = Date.now();
      const recovered = await recoverStaleJobs(db);
      if (recovered > 0) log.warn({ recovered }, "stale jobs requeued");
    }
    const jobs = await claimJobs(db, workerId, concurrency, Object.keys(handlers));
    await Promise.all(jobs.map(process));
    return jobs.length;
  }

  async function loop() {
    while (running) {
      let processed = 0;
      try {
        processed = await runOnce();
        if (heartbeatFile) await writeFile(heartbeatFile, String(Date.now()));
      } catch (error) {
        log.error({ err: { type: (error as Error).name, message: (error as Error).message } }, "worker loop error");
      }
      if (running && processed === 0) await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  return {
    runOnce,
    start() {
      if (running) return;
      running = true;
      log.info({ workerId }, "worker started");
      current = loop();
    },
    // Termina el lote en curso y sale.
    async stop() {
      running = false;
      await current;
    },
  };
}
