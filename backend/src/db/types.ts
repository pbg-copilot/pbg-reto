import type { ColumnType, Generated, Insertable, Selectable } from "kysely";

// Tipos escritos a mano solo para el esquema helpdesk. Cada spec agrega los suyos.
type DefaultTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
type Json = ColumnType<unknown, unknown, unknown>;

export interface JobsTable {
  id: Generated<string>;
  type: string;
  payload: ColumnType<Record<string, unknown>, Record<string, unknown> | undefined, Record<string, unknown>>;
  status: Generated<"queued" | "running" | "succeeded" | "failed">;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  run_at: DefaultTimestamp;
  locked_by: string | null;
  locked_until: NullableTimestamp;
  last_error: string | null;
  dedupe_key: string | null;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface IdempotencyKeysTable {
  account_id: string;
  key: string;
  method: string;
  path: string;
  request_hash: string;
  status: "in_progress" | "completed";
  response_status: number | null;
  response_body: Json | null;
  created_at: DefaultTimestamp;
  expires_at: DefaultTimestamp;
}

type JsonObject = ColumnType<Record<string, unknown>, Record<string, unknown> | string | undefined, Record<string, unknown> | string>;
type JsonArray = ColumnType<unknown[], unknown[] | string | undefined, unknown[] | string>;

export interface CategoriesTable {
  code: string;
  name: string;
  sort: Generated<number>;
  is_active: Generated<boolean>;
}

export interface PrioritiesTable {
  code: string;
  name: string;
  rank: number;
  first_response_target_minutes: number | null;
  resolution_target_minutes: number | null;
  is_active: Generated<boolean>;
}

export interface TicketsTable {
  id: Generated<string>;
  number: Generated<number>;
  title: string;
  original_description: string;
  ai_summary: ColumnType<Record<string, unknown> | null, Record<string, unknown> | string | null | undefined, Record<string, unknown> | string | null>;
  requester_id: string;
  category_code: string;
  impact: Generated<"low" | "medium" | "high" | "critical">;
  priority_code: string;
  status: Generated<"open" | "in_review" | "closed">;
  assignee_id: string | null;
  source: "assistant" | "manual_form" | "human_request";
  conversation_id: string | null;
  incident_id: string | null;
  attempted_steps: JsonArray;
  tags: ColumnType<string[], string[] | undefined, string[]>;
  closure_reason: "resolved" | "duplicate" | "invalid" | "no_response" | "other" | null;
  resolution_summary: string | null;
  duplicate_of_ticket_id: string | null;
  reopened_count: Generated<number>;
  version: Generated<number>;
  first_response_at: NullableTimestamp;
  last_team_reply_at: NullableTimestamp;
  last_requester_reply_at: NullableTimestamp;
  last_public_activity_at: DefaultTimestamp;
  last_activity_at: DefaultTimestamp;
  closed_at: NullableTimestamp;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface TicketCommentsTable {
  id: Generated<string>;
  ticket_id: string;
  author_id: string;
  visibility: "public" | "internal";
  body: string;
  requests_info: Generated<boolean>;
  edited_at: NullableTimestamp;
  created_at: DefaultTimestamp;
}

export interface TicketCommentRevisionsTable {
  id: Generated<string>;
  comment_id: string;
  previous_body: string;
  edited_by: string;
  edited_at: DefaultTimestamp;
}

export interface TicketEventsTable {
  id: Generated<number>;
  ticket_id: string;
  actor_id: string | null;
  type: string;
  visibility: "public" | "internal";
  data: JsonObject;
  created_at: DefaultTimestamp;
}

export interface TicketReadsTable {
  account_id: string;
  ticket_id: string;
  last_read_at: DefaultTimestamp;
}

// Vista del repo base (solo lectura). Nunca seleccionar password_hash.
export interface AgentsView {
  id: string;
  username: string;
  email: string;
  name: string;
  role: string;
  agency_id: string | null;
}

export interface DB {
  "helpdesk.jobs": JobsTable;
  "helpdesk.idempotency_keys": IdempotencyKeysTable;
  "helpdesk.categories": CategoriesTable;
  "helpdesk.priorities": PrioritiesTable;
  "helpdesk.tickets": TicketsTable;
  "helpdesk.ticket_comments": TicketCommentsTable;
  "helpdesk.ticket_comment_revisions": TicketCommentRevisionsTable;
  "helpdesk.ticket_events": TicketEventsTable;
  "helpdesk.ticket_reads": TicketReadsTable;
  "reto.agents": AgentsView;
}

export type Job = Selectable<JobsTable>;
export type TicketRow = Selectable<TicketsTable>;
export type TicketEventRow = Selectable<TicketEventsTable>;
export type CommentRow = Selectable<TicketCommentsTable>;
export type NewJob = Insertable<JobsTable>;
