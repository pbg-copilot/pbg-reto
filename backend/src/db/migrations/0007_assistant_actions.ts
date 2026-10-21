/* eslint-disable @typescript-eslint/no-explicit-any -- patrón oficial de Kysely para migraciones */
import { sql, type Kysely } from "kysely";

// Acciones que el asistente propone y la persona confirma (specs/009-assistant-skills/plan.md).
// El modelo nunca ejecuta: solo crea filas "proposed"; el clic del usuario las ejecuta.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE helpdesk.assistant_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id uuid NOT NULL REFERENCES helpdesk.conversations(id) ON DELETE CASCADE,
      message_id uuid REFERENCES helpdesk.conversation_messages(id) ON DELETE SET NULL,
      requester_id text NOT NULL REFERENCES onboarding.accounts(id),
      type text NOT NULL CHECK (type IN ('comment_on_ticket','reopen_ticket')),
      ticket_id uuid NOT NULL REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
      payload jsonb NOT NULL,
      status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','cancelled','expired','failed')),
      result jsonb,
      proposed_at timestamptz NOT NULL DEFAULT now(),
      decided_at timestamptz,
      expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
    )
  `.execute(db);
  await sql`CREATE INDEX assistant_actions_conversation_idx ON helpdesk.assistant_actions (conversation_id, proposed_at)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS helpdesk.assistant_actions`.execute(db);
}
