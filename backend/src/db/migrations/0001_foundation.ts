/* eslint-disable @typescript-eslint/no-explicit-any -- patrón oficial de Kysely para migraciones */
import { sql, type Kysely } from "kysely";

// Esquema propio del reto. No toca los esquemas originales de la réplica.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS helpdesk`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS unaccent SCHEMA public`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public`.execute(db);

  // unaccent no es IMMUTABLE; este envoltorio permite usarlo en índices y columnas generadas.
  await sql`
    CREATE OR REPLACE FUNCTION helpdesk.immutable_unaccent(text) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
      AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$
  `.execute(db);

  await sql`
    CREATE TABLE helpdesk.jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      type text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued','running','succeeded','failed')),
      attempts int NOT NULL DEFAULT 0,
      max_attempts int NOT NULL DEFAULT 8 CHECK (max_attempts > 0),
      run_at timestamptz NOT NULL DEFAULT now(),
      locked_by text,
      locked_until timestamptz,
      last_error text,
      dedupe_key text UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX jobs_ready_idx ON helpdesk.jobs (run_at) WHERE status = 'queued'`.execute(db);
  await sql`CREATE INDEX jobs_running_idx ON helpdesk.jobs (locked_until) WHERE status = 'running'`.execute(db);

  await sql`
    CREATE TABLE helpdesk.idempotency_keys (
      account_id text NOT NULL REFERENCES onboarding.accounts(id),
      key text NOT NULL,
      method text NOT NULL,
      path text NOT NULL,
      request_hash text NOT NULL,
      status text NOT NULL CHECK (status IN ('in_progress','completed')),
      response_status int,
      response_body jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
      PRIMARY KEY (account_id, key)
    )
  `.execute(db);
  await sql`CREATE INDEX idempotency_keys_expires_idx ON helpdesk.idempotency_keys (expires_at)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS helpdesk.idempotency_keys`.execute(db);
  await sql`DROP TABLE IF EXISTS helpdesk.jobs`.execute(db);
  await sql`DROP FUNCTION IF EXISTS helpdesk.immutable_unaccent(text)`.execute(db);
}
