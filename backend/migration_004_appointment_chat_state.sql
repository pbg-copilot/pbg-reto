CREATE TABLE reto.chat_appointment_chat_state (
  conversation_id uuid PRIMARY KEY
    REFERENCES reto.chat_conversations(id) ON DELETE CASCADE,
  requested_by_account_id text NOT NULL
    REFERENCES onboarding.accounts(id) ON DELETE CASCADE,
  client_document_path text NOT NULL,
  client_record_id text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('details', 'confirmation')),
  confirmation_id uuid
    REFERENCES reto.chat_appointment_confirmations(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_appointment_chat_state_confirmation
    CHECK ((stage = 'confirmation' AND confirmation_id IS NOT NULL)
        OR (stage = 'details' AND confirmation_id IS NULL))
);
