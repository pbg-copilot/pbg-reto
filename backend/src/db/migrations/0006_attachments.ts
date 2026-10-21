/* eslint-disable @typescript-eslint/no-explicit-any -- patrón oficial de Kysely para migraciones */
import { sql, type Kysely } from "kysely";

// Adjuntos de tickets y del chat (specs/006-attachments/plan.md). Metadatos aquí; el binario
// en el bucket S3 privado, con una clave que nunca incluye el nombre original.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE helpdesk.attachments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id uuid REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
      conversation_id uuid REFERENCES helpdesk.conversations(id) ON DELETE CASCADE,
      comment_id uuid REFERENCES helpdesk.ticket_comments(id) ON DELETE SET NULL,
      message_id uuid REFERENCES helpdesk.conversation_messages(id) ON DELETE SET NULL,
      uploader_id text NOT NULL REFERENCES onboarding.accounts(id),
      visibility text NOT NULL CHECK (visibility IN ('public','internal')),
      original_name text NOT NULL CHECK (length(original_name) BETWEEN 1 AND 200),
      mime_type text NOT NULL,
      size_bytes bigint NOT NULL CHECK (size_bytes > 0),
      sha256 text NOT NULL,
      storage_key text NOT NULL UNIQUE,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
      removed_at timestamptz,
      removed_by text REFERENCES onboarding.accounts(id),
      removal_reason text,
      -- Visión con consentimiento (AC-006.12): cuándo se compartió la imagen con el asistente.
      shared_with_ai_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (ticket_id IS NOT NULL OR conversation_id IS NOT NULL),
      CHECK (status = 'active' OR (removed_at IS NOT NULL AND removed_by IS NOT NULL AND removal_reason IS NOT NULL))
    )
  `.execute(db);
  await sql`CREATE INDEX attachments_ticket_idx ON helpdesk.attachments (ticket_id, created_at) WHERE ticket_id IS NOT NULL`.execute(db);
  await sql`CREATE INDEX attachments_conversation_idx ON helpdesk.attachments (conversation_id) WHERE conversation_id IS NOT NULL`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS helpdesk.attachments`.execute(db);
}
