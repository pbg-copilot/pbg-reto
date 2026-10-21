import type { ColumnType, Generated, Insertable, Selectable } from "kysely";

// Tipos escritos a mano solo para el esquema helpdesk. Cada spec agrega los suyos.
type DefaultTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
type Json = ColumnType<unknown, unknown, unknown>;

export interface JobsTable {
  id: Generated<string>;
  type: string;
  payload: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  status: Generated<"queued" | "running" | "succeeded" | "failed">;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  run_at: DefaultTimestamp;
  locked_by: string | null;
  locked_until: NullableTimestamp;
  last_error: string | null;
  dedupe_key: string | null;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface IdempotencyKeysTable {
  account_id: string;
  key: string;
  method: string;
  path: string;
  request_hash: string;
  status: "in_progress" | "completed";
  response_status: number | null;
  response_body: Json | null;
  created_at: DefaultTimestamp;
  expires_at: DefaultTimestamp;
}

export interface DB {
  "helpdesk.jobs": JobsTable;
  "helpdesk.idempotency_keys": IdempotencyKeysTable;
}

export type Job = Selectable<JobsTable>;
export type NewJob = Insertable<JobsTable>;
