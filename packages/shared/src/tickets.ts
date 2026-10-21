import { z } from "zod";
import { paginatedSchema, paginationQuerySchema } from "./pagination.js";

// Dominio de tickets (specs/000-overview/domain.md). Códigos en inglés, etiquetas en español.

export const TICKET_STATUSES = ["open", "in_review", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const statusLabel: Record<TicketStatus, string> = {
  open: "Abierto",
  in_review: "En revisión",
  closed: "Cerrado",
};

export const CLOSURE_REASONS = ["resolved", "duplicate", "invalid", "no_response", "other"] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];
export const closureReasonLabel: Record<ClosureReason, string> = {
  resolved: "Resuelto",
  duplicate: "Duplicado",
  invalid: "Reporte inválido",
  no_response: "Sin respuesta del solicitante",
  other: "Otro motivo",
};

export const IMPACTS = ["low", "medium", "high", "critical"] as const;
export type Impact = (typeof IMPACTS)[number];
export const impactLabel: Record<Impact, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  critical: "Crítico",
};

export const TICKET_SOURCES = ["assistant", "manual_form", "human_request"] as const;
export type TicketSource = (typeof TICKET_SOURCES)[number];

export const COMMENT_VISIBILITIES = ["public", "internal"] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];

export const AGE_FILTERS = ["gt_24h", "gt_72h", "gt_7d"] as const;
export const TICKET_SORTS = ["updated_at", "created_at", "priority", "number"] as const;

export const displayNumber = (number: number) => `TCK-${String(number).padStart(6, "0")}`;

// Acepta "TCK-000042", "tck-42" o "42".
export function parseTicketNumber(value: string): number | null {
  const match = /^(?:tck-)?0*(\d{1,9})$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

const isoDate = z.string().describe("Fecha ISO 8601 (UTC)");
const personSchema = z.object({ id: z.string(), name: z.string() });

// ---------- Bodies ----------

export const createTicketBodySchema = z.strictObject({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(10).max(10000),
  category: z.string().min(1).max(40),
  impact: z.enum(IMPACTS).default("medium"),
});
export type CreateTicketBody = z.input<typeof createTicketBodySchema>;

export const changeStatusBodySchema = z.strictObject({
  status: z.enum(TICKET_STATUSES),
  version: z.number().int().min(1),
  closure_reason: z.enum(CLOSURE_REASONS).optional(),
  resolution_summary: z.string().trim().min(3).max(4000).optional(),
  duplicate_of_number: z.number().int().min(1).optional(),
});
export type ChangeStatusBody = z.infer<typeof changeStatusBodySchema>;

export const reopenBodySchema = z.strictObject({
  version: z.number().int().min(1),
  reason: z.string().trim().min(3).max(2000),
});
export type ReopenBody = z.infer<typeof reopenBodySchema>;

export const assignBodySchema = z.strictObject({
  version: z.number().int().min(1),
  assignee_id: z.string().min(1).nullable(),
});
export type AssignBody = z.infer<typeof assignBodySchema>;

export const updateTicketBodySchema = z
  .strictObject({
    version: z.number().int().min(1),
    priority: z.string().min(1).max(40).optional(),
    category: z.string().min(1).max(40).optional(),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  })
  .refine((body) => body.priority !== undefined || body.category !== undefined || body.tags !== undefined, {
    message: "Indica al menos un cambio",
  });
export type UpdateTicketBody = z.infer<typeof updateTicketBodySchema>;

export const commentBodySchema = z.strictObject({
  body: z.string().trim().min(1).max(10000),
  visibility: z.enum(COMMENT_VISIBILITIES).default("public"),
  requests_info: z.boolean().default(false),
});
export type CommentBody = z.input<typeof commentBodySchema>;

export const editCommentBodySchema = z.strictObject({
  body: z.string().trim().min(1).max(10000),
});

// ---------- Query ----------

const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");

export const listTicketsQuerySchema = paginationQuerySchema.extend({
  view: z.enum(TICKET_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
  category: z.string().max(40).optional(),
  priority: z.string().max(40).optional(),
  assignee: z.string().max(64).optional().describe("me | unassigned | id de un admin (solo admin)"),
  requester: z.string().max(64).optional().describe("id del solicitante (solo admin)"),
  age: z.enum(AGE_FILTERS).optional(),
  unread: booleanQuery.optional(),
  unattended: booleanQuery.optional().describe("Abiertos sin primera respuesta del equipo (solo admin)"),
  sort: z.enum(TICKET_SORTS).default("updated_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListTicketsQuery = z.input<typeof listTicketsQuerySchema>;
export type ListTicketsFilters = z.output<typeof listTicketsQuerySchema>;

// ---------- Responses ----------

export const ticketSummarySchema = z.object({
  id: z.string(),
  number: z.number().int(),
  display_number: z.string(),
  title: z.string(),
  status: z.enum(TICKET_STATUSES),
  category: z.string(),
  priority: z.string(),
  impact: z.enum(IMPACTS),
  requester: personSchema,
  created_at: isoDate,
  // Para el solicitante solo cuenta la actividad pública.
  updated_at: isoDate,
  unread: z.boolean(),
  // Solo para administradores.
  assignee: personSchema.nullable().optional(),
  first_response_at: isoDate.nullable().optional(),
  last_team_reply_at: isoDate.nullable().optional(),
  unattended: z.boolean().optional(),
});
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

export const ticketListSchema = paginatedSchema(ticketSummarySchema).extend({
  counts: z.object({ open: z.number().int(), in_review: z.number().int(), closed: z.number().int() }),
});
export type TicketList = z.infer<typeof ticketListSchema>;

export const attemptedStepSchema = z.object({
  step: z.string(),
  result: z.string(),
  article_id: z.string().optional(),
  article_version: z.number().int().optional(),
});

export const commentSchema = z.object({
  id: z.string(),
  author: personSchema.extend({ is_team: z.boolean() }),
  visibility: z.enum(COMMENT_VISIBILITIES),
  body: z.string(),
  requests_info: z.boolean(),
  edited_at: isoDate.nullable(),
  created_at: isoDate,
});
export type TicketComment = z.infer<typeof commentSchema>;

export const ticketEventSchema = z.object({
  id: z.number().int(),
  type: z.string(),
  visibility: z.enum(COMMENT_VISIBILITIES),
  actor: personSchema.nullable(),
  data: z.record(z.string(), z.unknown()),
  created_at: isoDate,
});
export type TicketEvent = z.infer<typeof ticketEventSchema>;

export const ticketPermissionsSchema = z.object({
  can_comment: z.boolean(),
  can_add_internal_note: z.boolean(),
  can_change_status: z.boolean(),
  can_reopen: z.boolean(),
  can_assign: z.boolean(),
  can_edit_attributes: z.boolean(),
});
export type TicketPermissions = z.infer<typeof ticketPermissionsSchema>;

export const ticketDetailSchema = ticketSummarySchema.extend({
  original_description: z.string(),
  ai_summary: z.record(z.string(), z.unknown()).nullable(),
  attempted_steps: z.array(attemptedStepSchema),
  source: z.enum(TICKET_SOURCES),
  conversation_id: z.string().nullable(),
  closure_reason: z.enum(CLOSURE_REASONS).nullable(),
  resolution_summary: z.string().nullable(),
  duplicate_of: z.object({ id: z.string(), display_number: z.string() }).nullable(),
  reopened_count: z.number().int(),
  closed_at: isoDate.nullable(),
  version: z.number().int(),
  comments: z.array(commentSchema),
  events: z.array(ticketEventSchema),
  permissions: ticketPermissionsSchema,
  // Solo para administradores.
  tags: z.array(z.string()).optional(),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

export const categorySchema = z.object({ code: z.string(), name: z.string() });
export type Category = z.infer<typeof categorySchema>;

export const prioritySchema = z.object({
  code: z.string(),
  name: z.string(),
  rank: z.number().int(),
  // Solo para administradores (spec 007): el solicitante nunca ve objetivos.
  first_response_target_minutes: z.number().int().nullable().optional(),
  resolution_target_minutes: z.number().int().nullable().optional(),
});
export type Priority = z.infer<typeof prioritySchema>;

export const adminSchema = z.object({ id: z.string(), name: z.string(), email: z.string() });
export type SupportAdmin = z.infer<typeof adminSchema>;
