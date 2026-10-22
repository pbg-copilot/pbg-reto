export type Agent = {
  id: string;
  name: string;
  username: string;
  email: string;
  agency_name: string | null;
  role: string;
};
export type Conversation = {
  id: string;
  title: string | null;
  status: "active" | "archived";
  active_client_path: string | null;
  active_client_record_id: string | null;
  updated_at: string;
};
export type Message = {
  id: string;
  sequence_no: string;
  sender_role: "user" | "assistant" | "tool";
  content: string;
  created_at: string;
};
export type Client = {
  document_path: string;
  client_record_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string | null;
};
export type ClientProfile = {
  client: { id: string; name: string | null; email: string | null; phone: string | null; stage: string | null };
  source: { type: string; document_path: string; client_record_id: string; date: string | null };
  missing: string[];
  notes_status: "loaded" | "empty" | "unavailable";
  notes: Array<{ id: string; index: string; text: { original?: string | null; es?: string | null; en?: string | null }; occurred_at: string | null; source: { document_path: string; client_record_id: string; note_id: string; note_index: string; date: string | null } }>;
  activity: { status: "loaded" | "partial" | "empty" | "unavailable"; entries: Array<{ call_id: string; note_id: string; occurred_at: string; source: { document_path: string; client_record_id: string; note_id: string; note_index: string; date: string | null } }>; reason?: string | null };
};
export type QuoteResponse = {
  quotes_status: "loaded" | "empty";
  quotes: Array<{ id: string; carrier: string | null; product: string | null; face_amount_cents: string | null; monthly_premium_cents: string | null; annual_premium_cents: string | null; recorded_at: string | null; source: { type: string; table: string; record_id: string; client_record_id: string; date: string | null; match_basis: string } }>;
  rules: { status: string; reason: string };
  missing: string[];
};
export type Appointment = {
  id: string;
  conversation_id: string;
  client_document_path: string;
  client_record_id: string;
  agent_account_id: string;
  start_at: string;
  end_at: string;
  time_zone: string;
  local_start: string;
  start_utc_offset_minutes: number;
  status: "confirmed" | "cancelled";
};
export type FollowUp = {
  id: string;
  description: string;
  due_date: string;
  status: "pending" | "completed";
  created_at: string;
};
export type AppointmentAction = "create" | "reschedule" | "cancel";
export type AppointmentConfirmation = {
  id: string;
  expires_at: string;
  action: AppointmentAction;
  appointment_id: string | null;
  client_document_path: string;
  client_record_id: string;
  agent_account_id: string;
  interval: { start_at: string; end_at: string; duration_minutes: number; time_zone: string; start_local: string; end_local: string; start_utc_offset_minutes: number };
};
export type AppointmentMutationResult = { action: AppointmentAction; appointment: Appointment; idempotent_replay?: boolean };
export type AppointmentChatKind = "request_details" | "invalid_details" | "review" | "repeat_confirmation" | "created" | "conflict" | "cancelled" | "appointments_list";
export type AppointmentChatStage = "idle" | "details" | "confirmation";
