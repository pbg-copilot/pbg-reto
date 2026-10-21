/* eslint-disable @typescript-eslint/no-explicit-any -- patrón oficial de Kysely para migraciones */
import { sql, type Kysely } from "kysely";

// Índices del panel de soporte (spec 007, AC-007.14/15). Medido con 20.000 tickets: la
// tendencia diaria bajó de ~340 ms a ~14 ms.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE INDEX tickets_closed_idx ON helpdesk.tickets (closed_at) WHERE closed_at IS NOT NULL`.execute(db);
  await sql`CREATE INDEX conversations_created_idx ON helpdesk.conversations (created_at)`.execute(db);
  // "Esperan al solicitante": solicitudes de información por ticket.
  await sql`CREATE INDEX ticket_comments_requests_info_idx ON helpdesk.ticket_comments (ticket_id, created_at) WHERE requests_info`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS helpdesk.ticket_comments_requests_info_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS helpdesk.conversations_created_idx`.execute(db);
  await sql`DROP INDEX IF EXISTS helpdesk.tickets_closed_idx`.execute(db);
}
