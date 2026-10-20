CREATE SCHEMA IF NOT EXISTS reto;
CREATE TABLE IF NOT EXISTS reto.imports (id text PRIMARY KEY, metadata jsonb NOT NULL, loaded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS reto.agencies (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS reto.agents (
  id uuid PRIMARY KEY, agency_id uuid REFERENCES reto.agencies(id), username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE, name text NOT NULL, phone text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'agent', password_hash text NOT NULL, profile jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS reto.clients (
  id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES reto.agents(id), agency_id uuid REFERENCES reto.agencies(id),
  name text NOT NULL, email text NOT NULL, phone text NOT NULL, state text NOT NULL DEFAULT '',
  stage text NOT NULL DEFAULT 'new', profile jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS reto.licenses (id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES reto.agents(id), state text NOT NULL, license_number text NOT NULL, details jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS reto.quotes (id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES reto.agents(id), client_id uuid REFERENCES reto.clients(id), carrier text NOT NULL DEFAULT '', product text NOT NULL DEFAULT '', details jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS reto.appointments (id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES reto.agents(id), client_id uuid REFERENCES reto.clients(id), details jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS reto.notes (id uuid PRIMARY KEY, agent_id uuid NOT NULL REFERENCES reto.agents(id), client_id uuid REFERENCES reto.clients(id), details jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS reto.source_records (source_table text NOT NULL, id uuid NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(source_table,id));
CREATE TABLE IF NOT EXISTS reto.sessions (token_hash text PRIMARY KEY, agent_id uuid NOT NULL UNIQUE REFERENCES reto.agents(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS clients_owner ON reto.clients(agent_id);
CREATE INDEX IF NOT EXISTS quotes_owner ON reto.quotes(agent_id,client_id);
CREATE INDEX IF NOT EXISTS appointments_owner ON reto.appointments(agent_id,client_id);
