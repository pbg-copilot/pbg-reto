-- Local authentication only. Business tables retain their original schemas.
CREATE SCHEMA IF NOT EXISTS reto;
CREATE TABLE IF NOT EXISTS reto.imports (id text PRIMARY KEY, metadata jsonb NOT NULL, loaded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reto.account_aliases (account_id text PRIMARY KEY REFERENCES onboarding.accounts(id), username text NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS reto.sessions (token_hash text PRIMARY KEY, agent_id text NOT NULL UNIQUE REFERENCES onboarding.accounts(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
CREATE OR REPLACE VIEW reto.agencies AS SELECT * FROM onboarding.agencies;
CREATE OR REPLACE VIEW reto.agents AS
SELECT a.id, a.agency_id, x.username, a.email,
       coalesce(nullif(trim(concat_ws(' ', p.first_name, p.middle_name, p.last_name)), ''), a.email) AS name,
       coalesce(p.agent_phone, '') AS phone, a.role, a.password_hash,
       coalesce(to_jsonb(p), '{}'::jsonb) AS profile
FROM onboarding.accounts a
JOIN reto.account_aliases x ON x.account_id = a.id
LEFT JOIN onboarding.profiles p ON p.account_id = a.id;
