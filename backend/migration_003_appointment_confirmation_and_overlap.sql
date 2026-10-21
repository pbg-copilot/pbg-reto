CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE reto.chat_appointment_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL
    REFERENCES reto.chat_conversations(id) ON DELETE CASCADE,
  requested_by_account_id text NOT NULL
    REFERENCES onboarding.accounts(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('create', 'reschedule', 'cancel')),
  appointment_id uuid
    REFERENCES reto.chat_appointments(id) ON DELETE RESTRICT,
  client_document_path text NOT NULL,
  client_record_id text NOT NULL,
  agent_account_id text NOT NULL
    REFERENCES onboarding.accounts(id) ON DELETE RESTRICT,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  local_start timestamp without time zone NOT NULL,
  start_utc_offset_minutes smallint NOT NULL
    CHECK (start_utc_offset_minutes BETWEEN -840 AND 840),
  target_fingerprint text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'consumed', 'invalidated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  consumed_at timestamptz,
  CONSTRAINT chat_appointment_confirmations_interval
    CHECK (end_at > start_at),
  CONSTRAINT chat_appointment_confirmations_target
    CHECK ((action = 'create' AND appointment_id IS NULL AND target_fingerprint IS NULL)
        OR (action IN ('reschedule', 'cancel')
            AND appointment_id IS NOT NULL AND target_fingerprint IS NOT NULL)),
  CONSTRAINT chat_appointment_confirmations_state
    CHECK ((status = 'consumed' AND consumed_at IS NOT NULL)
        OR (status IN ('pending', 'invalidated') AND consumed_at IS NULL))
);

ALTER TABLE reto.chat_appointments
  ADD COLUMN last_confirmation_id uuid
    REFERENCES reto.chat_appointment_confirmations(id) ON DELETE RESTRICT;

ALTER TABLE reto.chat_actions
  ADD COLUMN idempotency_fingerprint text;

ALTER TABLE reto.chat_actions
  ADD COLUMN result_snapshot jsonb;

CREATE INDEX chat_appointment_confirmations_pending
  ON reto.chat_appointment_confirmations
     (requested_by_account_id, conversation_id, expires_at)
  WHERE status = 'pending';

ALTER TABLE reto.chat_appointments
  ADD CONSTRAINT chat_appointments_no_active_overlap
  EXCLUDE USING gist (
    agent_account_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status = 'confirmed');
