CREATE TABLE reto.chat_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL
    REFERENCES reto.chat_conversations(id) ON DELETE CASCADE,
  client_document_path text NOT NULL,
  client_record_id text NOT NULL,
  created_by_account_id text NOT NULL
    REFERENCES onboarding.accounts(id) ON DELETE RESTRICT,
  description text NOT NULL
    CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT chat_follow_ups_completion_state
    CHECK ((status = 'pending' AND completed_at IS NULL)
        OR (status = 'completed' AND completed_at IS NOT NULL))
);

CREATE INDEX chat_follow_ups_client_due
  ON reto.chat_follow_ups
    (conversation_id, client_document_path, client_record_id, due_date, id)
  WHERE status = 'pending';

COMMENT ON TABLE reto.chat_follow_ups IS
  'Agent-created reminders scoped to the client context of a conversation.';
