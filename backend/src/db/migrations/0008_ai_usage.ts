/* eslint-disable @typescript-eslint/no-explicit-any -- patrón oficial de Kysely para migraciones */
import { sql, type Kysely } from "kysely";

// Uso del modelo fuera del chat (copiloto del equipo, spec 007). Suma al costo de IA.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE helpdesk.ai_usage (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      feature text NOT NULL CHECK (feature IN ('copilot_summary','copilot_reply')),
      actor_id text NOT NULL REFERENCES onboarding.accounts(id),
      ticket_id uuid REFERENCES helpdesk.tickets(id) ON DELETE SET NULL,
      model text NOT NULL,
      usage jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX ai_usage_created_idx ON helpdesk.ai_usage (created_at)`.execute(db);
  // Rango de fechas de las métricas sobre los tickets creados.
  await sql`CREATE INDEX tickets_created_idx ON helpdesk.tickets (created_at)`.execute(db);
  await sql`CREATE INDEX conversation_messages_created_idx ON helpdesk.conversation_messages (created_at) WHERE usage IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS helpdesk.conversation_messages_created_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS helpdesk.tickets_created_idx`.execute(db);
  await sql`DROP TABLE IF EXISTS helpdesk.ai_usage`.execute(db);
}
