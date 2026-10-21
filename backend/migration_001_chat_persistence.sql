CREATE TABLE reto.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_account_id text NOT NULL
    REFERENCES onboarding.accounts(id) ON DELETE RESTRICT,
  title text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  active_client_path text,
  active_client_record_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT chat_conversations_title_length
    CHECK (title IS NULL OR char_length(title) <= 200),
  CONSTRAINT chat_conversations_active_client_pair
    CHECK (num_nonnulls(active_client_path, active_client_record_id) IN (0, 2)),
  CONSTRAINT chat_conversations_archive_state
    CHECK ((status = 'active' AND archived_at IS NULL)
        OR (status = 'archived' AND archived_at IS NOT NULL))
);

COMMENT ON TABLE reto.chat_conversations IS
  'Conversation ownership and current context for the local Chat PBG application.';
COMMENT ON COLUMN reto.chat_conversations.active_client_path IS
  'Path of the selected source document; no FK because client books are JSON documents.';
COMMENT ON COLUMN reto.chat_conversations.active_client_record_id IS
  'Record id within the selected JSON document; must be resolved and authorized by the backend.';

CREATE INDEX chat_conversations_owner_updated
  ON reto.chat_conversations (owner_account_id, updated_at DESC, id);

CREATE TABLE reto.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL
    REFERENCES reto.chat_conversations(id) ON DELETE CASCADE,
  sequence_no bigint GENERATED ALWAYS AS IDENTITY,
  sender_role text NOT NULL
    CHECK (sender_role IN ('user', 'assistant', 'tool')),
  content text NOT NULL,
  client_document_path text,
  client_record_id text,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(evidence_refs) = 'array'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_conversation_sequence
    UNIQUE (conversation_id, sequence_no),
  CONSTRAINT chat_messages_client_pair
    CHECK (num_nonnulls(client_document_path, client_record_id) IN (0, 2))
);

COMMENT ON TABLE reto.chat_messages IS
  'Persisted user, assistant, and tool messages; metadata and evidence references must omit unnecessary personal data.';
COMMENT ON COLUMN reto.chat_messages.evidence_refs IS
  'Array of source references, not copied source records; backend validates access before returning them.';

CREATE TABLE reto.chat_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid
    REFERENCES reto.chat_conversations(id) ON DELETE SET NULL,
  actor_account_id text NOT NULL
    REFERENCES onboarding.accounts(id) ON DELETE RESTRICT,
  actor_role text NOT NULL,
  scope_agency_id text,
  action_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  outcome text NOT NULL
    CHECK (outcome IN ('succeeded', 'rejected', 'failed', 'conflict')),
  error_code text,
  idempotency_key text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_actions_idempotency_not_blank
    CHECK (idempotency_key IS NULL OR length(btrim(idempotency_key)) > 0)
);

COMMENT ON TABLE reto.chat_actions IS
  'Minimal audit trail for business actions; do not store full client payloads, credentials, or secrets.';
COMMENT ON COLUMN reto.chat_actions.scope_agency_id IS
  'Agency scope applied at action time, recorded as a snapshot without a live FK.';

CREATE UNIQUE INDEX chat_actions_actor_idempotency
  ON reto.chat_actions (actor_account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX chat_actions_actor_time
  ON reto.chat_actions (actor_account_id, occurred_at DESC);
CREATE INDEX chat_actions_entity_time
  ON reto.chat_actions (entity_type, entity_id, occurred_at DESC);
