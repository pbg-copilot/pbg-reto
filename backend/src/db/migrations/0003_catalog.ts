/* eslint-disable @typescript-eslint/no-explicit-any -- patrón oficial de Kysely para migraciones */
import { sql, type Kysely } from "kysely";

// Catálogo de problemas conocidos, versiones inmutables e incidentes (specs/003-catalog/plan.md).
export async function up(db: Kysely<any>): Promise<void> {
  // array_to_string es STABLE; este envoltorio IMMUTABLE permite usarlo en la columna generada.
  await sql`
    CREATE OR REPLACE FUNCTION helpdesk.tags_text(text[]) RETURNS text
      LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
      AS $$ SELECT array_to_string($1, ' ') $$
  `.execute(db);

  await sql`
    CREATE TABLE helpdesk.articles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
      category_code text NOT NULL REFERENCES helpdesk.categories(code),
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
      is_example boolean NOT NULL DEFAULT true,
      published_version_id uuid,
      source_ticket_id uuid REFERENCES helpdesk.tickets(id) ON DELETE SET NULL,
      created_by text REFERENCES onboarding.accounts(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      archived_at timestamptz,
      CHECK (status <> 'published' OR published_version_id IS NOT NULL)
    )
  `.execute(db);

  await sql`
    CREATE TABLE helpdesk.article_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      article_id uuid NOT NULL REFERENCES helpdesk.articles(id) ON DELETE CASCADE,
      version int NOT NULL CHECK (version > 0),
      title text NOT NULL,
      symptoms text NOT NULL,
      applies_to text NOT NULL DEFAULT '',
      diagnosis_steps text NOT NULL,
      solution text NOT NULL,
      escalation_conditions text NOT NULL,
      tags text[] NOT NULL DEFAULT '{}',
      reviewed_at date NOT NULL DEFAULT current_date,
      valid_until date,
      -- Se fija al publicar y nunca se borra: una conversación pudo usar esta versión.
      published_at timestamptz,
      created_by text REFERENCES onboarding.accounts(id),
      created_at timestamptz NOT NULL DEFAULT now(),
      search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('spanish', helpdesk.immutable_unaccent(title)), 'A') ||
        setweight(to_tsvector('spanish', helpdesk.immutable_unaccent(symptoms)), 'A') ||
        setweight(to_tsvector('spanish', helpdesk.immutable_unaccent(helpdesk.tags_text(tags))), 'B') ||
        setweight(to_tsvector('spanish', helpdesk.immutable_unaccent(solution || ' ' || diagnosis_steps)), 'C')
      ) STORED,
      UNIQUE (article_id, version)
    )
  `.execute(db);
  await sql`CREATE INDEX article_versions_search_idx ON helpdesk.article_versions USING gin (search_vector)`.execute(db);
  await sql`CREATE INDEX article_versions_title_trgm ON helpdesk.article_versions USING gin (helpdesk.immutable_unaccent(title) gin_trgm_ops)`.execute(db);
  await sql`
    ALTER TABLE helpdesk.articles ADD CONSTRAINT articles_published_version_fk
      FOREIGN KEY (published_version_id) REFERENCES helpdesk.article_versions(id) DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await sql`
    CREATE TABLE helpdesk.incidents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL,
      public_summary text NOT NULL,
      status text NOT NULL CHECK (status IN ('investigating','identified','monitoring','resolved')),
      category_code text REFERENCES helpdesk.categories(code),
      article_id uuid REFERENCES helpdesk.articles(id) ON DELETE SET NULL,
      started_at timestamptz NOT NULL DEFAULT now(),
      resolved_at timestamptz,
      created_by text REFERENCES onboarding.accounts(id),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    ALTER TABLE helpdesk.tickets ADD CONSTRAINT tickets_incident_fk
      FOREIGN KEY (incident_id) REFERENCES helpdesk.incidents(id) ON DELETE SET NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE helpdesk.tickets DROP CONSTRAINT IF EXISTS tickets_incident_fk`.execute(db);
  await sql`DROP TABLE IF EXISTS helpdesk.incidents`.execute(db);
  await sql`ALTER TABLE helpdesk.articles DROP CONSTRAINT IF EXISTS articles_published_version_fk`.execute(db);
  await sql`DROP TABLE IF EXISTS helpdesk.article_versions`.execute(db);
  await sql`DROP TABLE IF EXISTS helpdesk.articles`.execute(db);
  await sql`DROP FUNCTION IF EXISTS helpdesk.tags_text(text[])`.execute(db);
}
