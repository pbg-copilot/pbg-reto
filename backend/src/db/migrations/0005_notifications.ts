/* eslint-disable @typescript-eslint/no-explicit-any -- patrón oficial de Kysely para migraciones */
import { sql, type Kysely } from "kysely";

// Notificaciones persistentes y su entrega por canal (specs/005-notifications/plan.md).
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE helpdesk.notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_id text NOT NULL REFERENCES onboarding.accounts(id),
      ticket_id uuid REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
      type text NOT NULL,
      title text NOT NULL,
      body text NOT NULL DEFAULT '',
      payload jsonb NOT NULL DEFAULT '{}',
      link text NOT NULL,
      source_event_id bigint REFERENCES helpdesk.ticket_events(id) ON DELETE CASCADE,
      -- Una notificación por (evento, destinatario): reprocesar un evento no duplica.
      dedupe_key text NOT NULL UNIQUE,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX notifications_inbox_idx ON helpdesk.notifications (recipient_id, created_at DESC)`.execute(db);
  await sql`CREATE INDEX notifications_unread_idx ON helpdesk.notifications (recipient_id) WHERE read_at IS NULL`.execute(db);

  await sql`
    CREATE TABLE helpdesk.notification_deliveries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      notification_id uuid NOT NULL REFERENCES helpdesk.notifications(id) ON DELETE CASCADE,
      channel text NOT NULL CHECK (channel IN ('in_app','email')),
      status text NOT NULL CHECK (status IN ('pending','delivered','failed')),
      attempts int NOT NULL DEFAULT 0,
      last_error text,
      delivered_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (notification_id, channel)
    )
  `.execute(db);
  await sql`CREATE INDEX notification_deliveries_pending_idx ON helpdesk.notification_deliveries (status) WHERE status <> 'delivered'`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS helpdesk.notification_deliveries`.execute(db);
  await sql`DROP TABLE IF EXISTS helpdesk.notifications`.execute(db);
}
