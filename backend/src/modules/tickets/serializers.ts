import {
  displayNumber,
  isAdmin,
  type Agent,
  type TicketComment,
  type TicketDetail,
  type TicketEvent,
  type TicketSummary,
} from "@reto/shared";
import type { CommentWithAuthor, EventWithActor, TicketListRow } from "./repository.js";
import { permissionsFor } from "./policy.js";

const iso = (value: Date | string) => new Date(value).toISOString();
const isoOrNull = (value: Date | string | null) => (value ? iso(value) : null);

// El solicitante nunca recibe campos internos (asignación, etiquetas, tiempos del equipo).
export function toSummary(row: TicketListRow, actor: Agent): TicketSummary {
  const base: TicketSummary = {
    id: row.id,
    number: row.number,
    display_number: displayNumber(row.number),
    title: row.title,
    status: row.status,
    category: row.category_code,
    priority: row.priority_code,
    impact: row.impact,
    requester: { id: row.requester_id, name: row.requester_name },
    created_at: iso(row.created_at),
    updated_at: iso(row.activity_at),
    unread: Boolean(row.unread),
  };
  if (!isAdmin(actor)) return base;
  return {
    ...base,
    assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name ?? "" } : null,
    first_response_at: isoOrNull(row.first_response_at),
    last_team_reply_at: isoOrNull(row.last_team_reply_at),
    unattended: row.status === "open" && row.first_response_at === null,
  };
}

export function toComment(row: CommentWithAuthor, requesterId: string): TicketComment {
  return {
    id: row.id,
    author: { id: row.author_id, name: row.author_name, is_team: row.author_id !== requesterId },
    visibility: row.visibility,
    body: row.body,
    requests_info: row.requests_info,
    edited_at: isoOrNull(row.edited_at),
    created_at: iso(row.created_at),
  };
}

export function toEvent(row: EventWithActor): TicketEvent {
  return {
    id: row.id,
    type: row.type,
    visibility: row.visibility,
    actor: row.actor_id ? { id: row.actor_id, name: row.actor_name ?? "" } : null,
    data: row.data,
    created_at: iso(row.created_at),
  };
}

export function toDetail(
  row: TicketListRow,
  actor: Agent,
  parts: {
    comments: CommentWithAuthor[];
    events: EventWithActor[];
    duplicateOf: { id: string; number: number } | null;
  },
): TicketDetail {
  return {
    ...toSummary(row, actor),
    original_description: row.original_description,
    ai_summary: row.ai_summary,
    attempted_steps: row.attempted_steps as TicketDetail["attempted_steps"],
    source: row.source,
    conversation_id: row.conversation_id,
    closure_reason: row.closure_reason,
    resolution_summary: row.resolution_summary,
    duplicate_of: parts.duplicateOf
      ? { id: parts.duplicateOf.id, display_number: displayNumber(parts.duplicateOf.number) }
      : null,
    reopened_count: row.reopened_count,
    closed_at: isoOrNull(row.closed_at),
    version: row.version,
    comments: parts.comments.map((comment) => toComment(comment, row.requester_id)),
    events: parts.events.map(toEvent),
    permissions: permissionsFor(actor, row),
    ...(isAdmin(actor) ? { tags: row.tags } : {}),
  };
}
