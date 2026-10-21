/* eslint-disable @typescript-eslint/no-explicit-any -- patrón oficial de Kysely para migraciones */
import { sql, type Kysely } from "kysely";

// Tickets, comentarios, auditoría y lecturas (specs/002-tickets/plan.md).
export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE helpdesk.categories (
      code text PRIMARY KEY,
      name text NOT NULL,
      sort int NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true
    )
  `.execute(db);

  await sql`
    CREATE TABLE helpdesk.priorities (
      code text PRIMARY KEY,
      name text NOT NULL,
      rank int NOT NULL UNIQUE,
      first_response_target_minutes int CHECK (first_response_target_minutes > 0),
      resolution_target_minutes int CHECK (resolution_target_minutes > 0),
      is_active boolean NOT NULL DEFAULT true
    )
  `.execute(db);

  await sql`CREATE SEQUENCE helpdesk.ticket_number_seq AS integer`.execute(db);

  await sql`
    CREATE TABLE helpdesk.tickets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      number integer NOT NULL UNIQUE DEFAULT nextval('helpdesk.ticket_number_seq'),
      title text NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
      original_description text NOT NULL,
      ai_summary jsonb,
      requester_id text NOT NULL REFERENCES onboarding.accounts(id),
      category_code text NOT NULL REFERENCES helpdesk.categories(code),
      impact text NOT NULL DEFAULT 'medium' CHECK (impact IN ('low','medium','high','critical')),
      priority_code text NOT NULL REFERENCES helpdesk.priorities(code),
      status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','closed')),
      assignee_id text REFERENCES onboarding.accounts(id),
      source text NOT NULL CHECK (source IN ('assistant','manual_form','human_request')),
      conversation_id uuid UNIQUE,
      incident_id uuid,
      attempted_steps jsonb NOT NULL DEFAULT '[]',
      tags text[] NOT NULL DEFAULT '{}',
      closure_reason text CHECK (closure_reason IN ('resolved','duplicate','invalid','no_response','other')),
      resolution_summary text,
      duplicate_of_ticket_id uuid REFERENCES helpdesk.tickets(id),
      reopened_count int NOT NULL DEFAULT 0,
      version int NOT NULL DEFAULT 1,
      first_response_at timestamptz,
      last_team_reply_at timestamptz,
      last_requester_reply_at timestamptz,
      last_public_activity_at timestamptz NOT NULL DEFAULT now(),
      last_activity_at timestamptz NOT NULL DEFAULT now(),
      closed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      -- Un ticket cerrado siempre tiene motivo; uno abierto, nunca.
      CHECK ((status = 'closed') = (closure_reason IS NOT NULL)),
      CHECK (duplicate_of_ticket_id IS NULL OR duplicate_of_ticket_id <> id)
    )
  `.execute(db);
  await sql`ALTER SEQUENCE helpdesk.ticket_number_seq OWNED BY helpdesk.tickets.number`.execute(db);
  await sql`CREATE INDEX tickets_requester_idx ON helpdesk.tickets (requester_id, status, last_public_activity_at DESC)`.execute(db);
  await sql`CREATE INDEX tickets_admin_idx ON helpdesk.tickets (status, priority_code, last_activity_at DESC)`.execute(db);
  await sql`CREATE INDEX tickets_assignee_idx ON helpdesk.tickets (assignee_id) WHERE assignee_id IS NOT NULL`.execute(db);
  await sql`CREATE INDEX tickets_title_trgm ON helpdesk.tickets USING gin (helpdesk.immutable_unaccent(title) gin_trgm_ops)`.execute(db);

  await sql`
    CREATE TABLE helpdesk.ticket_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id uuid NOT NULL REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
      author_id text NOT NULL REFERENCES onboarding.accounts(id),
      visibility text NOT NULL CHECK (visibility IN ('public','internal')),
      body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
      requests_info boolean NOT NULL DEFAULT false,
      edited_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX ticket_comments_ticket_idx ON helpdesk.ticket_comments (ticket_id, created_at)`.execute(db);

  await sql`
    CREATE TABLE helpdesk.ticket_comment_revisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      comment_id uuid NOT NULL REFERENCES helpdesk.ticket_comments(id) ON DELETE CASCADE,
      previous_body text NOT NULL,
      edited_by text NOT NULL REFERENCES onboarding.accounts(id),
      edited_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE TABLE helpdesk.ticket_events (
      id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      ticket_id uuid NOT NULL REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
      actor_id text REFERENCES onboarding.accounts(id),
      type text NOT NULL,
      visibility text NOT NULL CHECK (visibility IN ('public','internal')),
      data jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);
  await sql`CREATE INDEX ticket_events_ticket_idx ON helpdesk.ticket_events (ticket_id, id)`.execute(db);

  await sql`
    CREATE TABLE helpdesk.ticket_reads (
      account_id text NOT NULL REFERENCES onboarding.accounts(id),
      ticket_id uuid NOT NULL REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
      last_read_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, ticket_id)
    )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of ["ticket_reads", "ticket_events", "ticket_comment_revisions", "ticket_comments", "tickets", "priorities", "categories"])
    await sql`DROP TABLE IF EXISTS ${sql.table(`helpdesk.${table}`)}`.execute(db);
}
