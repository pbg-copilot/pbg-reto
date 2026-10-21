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

export interface ArticlesTable {
  id: Generated<string>;
  slug: string;
  category_code: string;
  status: Generated<"draft" | "published" | "archived">;
  is_example: Generated<boolean>;
  published_version_id: string | null;
  source_ticket_id: string | null;
  created_by: string | null;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
  archived_at: NullableTimestamp;
}

// Las columnas date llegan como "YYYY-MM-DD" (parser configurado en db/kysely.ts).
type DateColumn = ColumnType<string, string | undefined, string>;

export interface ArticleVersionsTable {
  id: Generated<string>;
  article_id: string;
  version: number;
  title: string;
  symptoms: string;
  applies_to: Generated<string>;
  diagnosis_steps: string;
  solution: string;
  escalation_conditions: string;
  tags: ColumnType<string[], string[] | undefined, string[]>;
  reviewed_at: DateColumn;
  valid_until: ColumnType<string | null, string | null | undefined, string | null>;
  published_at: NullableTimestamp;
  created_by: string | null;
  created_at: DefaultTimestamp;
}

export interface IncidentsTable {
  id: Generated<string>;
  title: string;
  public_summary: string;
  status: "investigating" | "identified" | "monitoring" | "resolved";
  category_code: string | null;
  article_id: string | null;
  started_at: DefaultTimestamp;
  resolved_at: NullableTimestamp;
  created_by: string | null;
  updated_at: DefaultTimestamp;
}

export interface ConversationsTable {
  id: Generated<string>;
  requester_id: string;
  status: Generated<"active" | "resolved" | "escalated">;
  title: string | null;
  case_details: JsonObject;
  attempted_steps: JsonArray;
  failed_article_ids: ColumnType<string[], string[] | undefined, string[]>;
  ticket_id: string | null;
  last_message_at: DefaultTimestamp;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface ConversationMessagesTable {
  id: Generated<string>;
  seq: Generated<string>;
  conversation_id: string;
  role: "user" | "assistant";
  kind: "message" | "tool_result" | "resolution_feedback" | "notice";
  content: JsonArray;
  display_text: string | null;
  visible: Generated<boolean>;
  client_message_id: string | null;
  article_refs: JsonArray;
  ticket_ref: ColumnType<Record<string, unknown> | null, Record<string, unknown> | string | null | undefined, Record<string, unknown> | string | null>;
  meta: JsonObject;
  model: string | null;
  usage: ColumnType<Record<string, unknown> | null, Record<string, unknown> | string | null | undefined, Record<string, unknown> | string | null>;
  created_at: DefaultTimestamp;
}

export interface NotificationsTable {
  id: Generated<string>;
  recipient_id: string;
  ticket_id: string | null;
  type: string;
  title: string;
  body: Generated<string>;
  payload: JsonObject;
  link: string;
  source_event_id: number | null;
  dedupe_key: string;
  read_at: NullableTimestamp;
  created_at: DefaultTimestamp;
}

export interface NotificationDeliveriesTable {
  id: Generated<string>;
  notification_id: string;
  channel: "in_app" | "email";
  status: "pending" | "delivered" | "failed";
  attempts: Generated<number>;
  last_error: string | null;
  delivered_at: NullableTimestamp;
  created_at: DefaultTimestamp;
  updated_at: DefaultTimestamp;
}

export interface AttachmentsTable {
  id: Generated<string>;
  ticket_id: string | null;
  conversation_id: string | null;
  comment_id: string | null;
  message_id: string | null;
  uploader_id: string;
  visibility: "public" | "internal";
  original_name: string;
  mime_type: string;
  size_bytes: ColumnType<string, number | string, number | string>;
  sha256: string;
  storage_key: string;
  status: Generated<"active" | "removed">;
  removed_at: NullableTimestamp;
  removed_by: string | null;
  removal_reason: string | null;
  shared_with_ai_at: NullableTimestamp;
  created_at: DefaultTimestamp;
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
  "helpdesk.articles": ArticlesTable;
  "helpdesk.article_versions": ArticleVersionsTable;
  "helpdesk.incidents": IncidentsTable;
  "helpdesk.conversations": ConversationsTable;
  "helpdesk.conversation_messages": ConversationMessagesTable;
  "helpdesk.notifications": NotificationsTable;
  "helpdesk.attachments": AttachmentsTable;
  "helpdesk.notification_deliveries": NotificationDeliveriesTable;
  "reto.agents": AgentsView;
}

export type Job = Selectable<JobsTable>;
export type TicketRow = Selectable<TicketsTable>;
export type TicketEventRow = Selectable<TicketEventsTable>;
export type CommentRow = Selectable<TicketCommentsTable>;
export type ArticleRow = Selectable<ArticlesTable>;
export type ArticleVersionRow = Selectable<ArticleVersionsTable>;
export type IncidentRow = Selectable<IncidentsTable>;
export type ConversationRow = Selectable<ConversationsTable>;
export type ConversationMessageRow = Selectable<ConversationMessagesTable>;
export type NotificationRow = Selectable<NotificationsTable>;
export type AttachmentRow = Selectable<AttachmentsTable>;
export type DeliveryRow = Selectable<NotificationDeliveriesTable>;
export type NewJob = Insertable<JobsTable>;
