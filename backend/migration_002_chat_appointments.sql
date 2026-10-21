CREATE TABLE reto.chat_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid
    REFERENCES reto.chat_conversations(id) ON DELETE SET NULL,
  client_document_path text,
  client_record_id text,
  agent_account_id text NOT NULL
    REFERENCES onboarding.accounts(id) ON DELETE RESTRICT,
  created_by_account_id text NOT NULL
    REFERENCES onboarding.accounts(id) ON DELETE RESTRICT,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  local_start timestamp without time zone NOT NULL,
  start_utc_offset_minutes smallint NOT NULL
    CHECK (start_utc_offset_minutes BETWEEN -840 AND 840),
  status text NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT chat_appointments_positive_interval CHECK (end_at > start_at),
  CONSTRAINT chat_appointments_client_pair
    CHECK (num_nonnulls(client_document_path, client_record_id) IN (0, 2)),
  CONSTRAINT chat_appointments_cancel_state
    CHECK ((status = 'confirmed' AND cancelled_at IS NULL)
        OR (status = 'cancelled' AND cancelled_at IS NOT NULL))
);

COMMENT ON TABLE reto.chat_appointments IS
  'Appointments created by the Chat PBG domain; separate from internal teamops bookings.';
COMMENT ON COLUMN reto.chat_appointments.start_at IS
  'Absolute start instant resolved from local_start and time_zone.';
COMMENT ON COLUMN reto.chat_appointments.local_start IS
  'Local wall-clock input retained alongside its resolved timezone and offset.';
COMMENT ON COLUMN reto.chat_appointments.start_utc_offset_minutes IS
  'Resolved offset at start time, retained to disambiguate historical local input.';

CREATE INDEX chat_appointments_agent_interval
  ON reto.chat_appointments (agent_account_id, start_at, end_at)
  WHERE status = 'confirmed';
