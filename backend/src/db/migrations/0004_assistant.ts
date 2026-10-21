/* eslint-disable @typescript-eslint/no-explicit-any -- patrón oficial de Kysely para migraciones */
import { sql, type Kysely } from "kysely";

// Conversaciones del chat de soporte y su historial completo (specs/004-assistant/plan.md).
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE helpdesk.conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_id text NOT NULL REFERENCES onboarding.accounts(id),
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','escalated')),
      title text,
      case_details jsonb NOT NULL DEFAULT '{}',
      attempted_steps jsonb NOT NULL DEFAULT '[]',
      failed_article_ids uuid[] NOT NULL DEFAULT '{}',
      ticket_id uuid UNIQUE REFERENCES helpdesk.tickets(id) ON DELETE SET NULL,
      last_message_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX conversations_requester_idx ON helpdesk.conversations (requester_id, last_message_at DESC)`.execute(db);

  await sql`
    CREATE TABLE helpdesk.conversation_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      seq bigint GENERATED ALWAYS AS IDENTITY,
      conversation_id uuid NOT NULL REFERENCES helpdesk.conversations(id) ON DELETE CASCADE,
      role text NOT NULL CHECK (role IN ('user','assistant')),
      kind text NOT NULL CHECK (kind IN ('message','tool_result','resolution_feedback','notice')),
      -- Content blocks de la API tal cual (incluye thinking): el historial es append-only.
      content jsonb NOT NULL DEFAULT '[]',
      display_text text,
      visible boolean NOT NULL DEFAULT true,
      client_message_id text,
      article_refs jsonb NOT NULL DEFAULT '[]',
      ticket_ref jsonb,
      meta jsonb NOT NULL DEFAULT '{}',
      model text,
      usage jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (conversation_id, client_message_id)
    )
  `.execute(db);
  await sql`CREATE INDEX conversation_messages_seq_idx ON helpdesk.conversation_messages (conversation_id, seq)`.execute(db);

  await sql`
    ALTER TABLE helpdesk.tickets ADD CONSTRAINT tickets_conversation_fk
      FOREIGN KEY (conversation_id) REFERENCES helpdesk.conversations(id) ON DELETE SET NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE helpdesk.tickets DROP CONSTRAINT IF EXISTS tickets_conversation_fk`.execute(db);
  await sql`DROP TABLE IF EXISTS helpdesk.conversation_messages`.execute(db);
  await sql`DROP TABLE IF EXISTS helpdesk.conversations`.execute(db);
}
