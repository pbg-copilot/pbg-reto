import { sql, type Kysely } from "kysely";
import type { DB, Job } from "../db/types.js";

type Executor = Kysely<DB>;

export type EnqueueInput = {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
};

// Recibe la transacción del llamador: el job se confirma junto con el cambio de
// negocio (outbox). Con dedupeKey, encolar dos veces lo mismo no duplica.
export async function enqueue(db: Executor, input: EnqueueInput) {
  return db
    .insertInto("helpdesk.jobs")
    .values({
      type: input.type,
      payload: input.payload ?? {},
      run_at: input.runAt ?? new Date(),
      dedupe_key: input.dedupeKey ?? null,
      max_attempts: input.maxAttempts ?? 8,
      locked_by: null,
      locked_until: null,
      last_error: null,
    })
    .onConflict((oc) => oc.column("dedupe_key").doNothing())
    .returning("id")
    .executeTakeFirst();
}

// Solo toma tipos que el worker sabe procesar: un job desconocido no se marca como fallido.
export async function claimJobs(
  db: Executor,
  workerId: string,
  limit: number,
  types: string[],
): Promise<Job[]> {
  if (types.length === 0) return [];
  const { rows } = await sql<Job>`
    UPDATE helpdesk.jobs
    SET status = 'running', locked_by = ${workerId}, locked_until = now() + interval '5 minutes',
        attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM helpdesk.jobs
      WHERE status = 'queued' AND run_at <= now() AND type = ANY(${types}::text[])
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING *
  `.execute(db);
  return rows;
}

export async function completeJob(db: Executor, id: string) {
  await db
    .updateTable("helpdesk.jobs")
    .set({ status: "succeeded", locked_by: null, locked_until: null, last_error: null, updated_at: new Date() })
    .where("id", "=", id)
    .execute();
}

// 10 s, 20 s, 40 s… hasta 10 min. `attempts` ya incluye el intento que falló.
export const backoffSeconds = (attempts: number) => Math.min(10 * 2 ** Math.max(attempts - 1, 0), 600);

export async function failJob(db: Executor, job: Job, error: unknown): Promise<"retry" | "failed"> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const final = job.attempts >= job.max_attempts;
  await db
    .updateTable("helpdesk.jobs")
    .set({
      status: final ? "failed" : "queued",
      run_at: final ? job.run_at : new Date(Date.now() + backoffSeconds(job.attempts) * 1000),
      locked_by: null,
      locked_until: null,
      last_error: message,
      updated_at: new Date(),
    })
    .where("id", "=", job.id)
    .execute();
  return final ? "failed" : "retry";
}

// Jobs de un worker que murió a mitad de camino vuelven a la cola.
export async function recoverStaleJobs(db: Executor) {
  const result = await db
    .updateTable("helpdesk.jobs")
    .set({ status: "queued", locked_by: null, locked_until: null, updated_at: new Date() })
    .where("status", "=", "running")
    .where("locked_until", "<", new Date())
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}
