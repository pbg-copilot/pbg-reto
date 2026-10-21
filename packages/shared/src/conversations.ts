import { z } from "zod";
import { paginatedSchema } from "./pagination.js";

// Chat de soporte con el asistente (specs/004-assistant).

export const CONVERSATION_STATUSES = ["active", "resolved", "escalated"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const CASE_FIELDS = ["area", "user_goal", "expected_result", "observed_error", "impact", "platform"] as const;
export type CaseField = (typeof CASE_FIELDS)[number];
export const caseFieldLabel: Record<CaseField, string> = {
  area: "Área afectada",
  user_goal: "Qué intentabas hacer",
  expected_result: "Resultado esperado",
  observed_error: "Error observado",
  impact: "Impacto",
  platform: "Plataforma",
};

export const ESCALATION_REASONS = ["no_article", "solution_failed", "failure_reported", "human_requested"] as const;
export const escalationReasonLabel: Record<(typeof ESCALATION_REASONS)[number], string> = {
  no_article: "Sin artículo aplicable",
  solution_failed: "La solución no funcionó",
  failure_reported: "Falla reportada",
  human_requested: "Pidió hablar con una persona",
};
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

const isoDate = z.string().describe("Fecha ISO 8601 (UTC)");

export const caseDetailsSchema = z.object({
  area: z.string().optional(),
  user_goal: z.string().optional(),
  expected_result: z.string().optional(),
  observed_error: z.string().optional(),
  impact: z.string().optional(),
  platform: z.string().optional(),
});
export type CaseDetails = z.infer<typeof caseDetailsSchema>;

export const articleRefSchema = z.object({
  article_id: z.string(),
  version_id: z.string(),
  version: z.number().int(),
  slug: z.string(),
  title: z.string(),
  url: z.string(),
  is_example: z.boolean(),
});
export type ArticleRef = z.infer<typeof articleRefSchema>;

export const ticketRefSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  display_number: z.string(),
  title: z.string(),
  status: z.enum(["open", "in_review", "closed"]),
  url: z.string(),
});
export type TicketRef = z.infer<typeof ticketRefSchema>;

// Adjunto de un mensaje del chat: solo metadatos y la ruta autorizada.
export const chatAttachmentSchema = z.object({
  id: z.string(),
  original_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int(),
  shared_with_ai: z.boolean(),
  download_url: z.string(),
});
export type ChatAttachment = z.infer<typeof chatAttachmentSchema>;

// Acción que el asistente propone y la persona confirma (009). El modelo nunca la ejecuta.
export const ASSISTANT_ACTION_TYPES = ["comment_on_ticket", "reopen_ticket"] as const;
export const ASSISTANT_ACTION_STATUSES = ["proposed", "confirmed", "cancelled", "expired", "failed"] as const;
export const assistantActionSchema = z.object({
  id: z.string(),
  type: z.enum(ASSISTANT_ACTION_TYPES),
  status: z.enum(ASSISTANT_ACTION_STATUSES),
  ticket: z.object({ id: z.string(), display_number: z.string(), url: z.string() }),
  text: z.string().describe("Comentario o motivo exacto que se enviará al confirmar"),
  expires_at: isoDate,
  decided_at: isoDate.nullable(),
  error: z.string().nullable(),
});
export type AssistantAction = z.infer<typeof assistantActionSchema>;
export const assistantActionLabel: Record<AssistantAction["type"], string> = {
  comment_on_ticket: "Agregar comentario",
  reopen_ticket: "Reabrir ticket",
};

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  kind: z.enum(["message", "resolution_feedback", "notice"]),
  text: z.string(),
  article_refs: z.array(articleRefSchema),
  ticket_ref: ticketRefSchema.nullable(),
  // Avisos del sistema: el asistente no respondió, se ocultó un dato sensible…
  notice: z.enum(["assistant_unavailable", "secret_redacted", "action_confirmed"]).nullable(),
  actions: z.array(assistantActionSchema),
  attachments: z.array(chatAttachmentSchema),
  // Datos reales que respaldan la respuesta (009): la UI muestra «Basado en los datos de tu cuenta».
  evidence: z.array(z.enum(["account_status"])),
  created_at: isoDate,
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const conversationStateSchema = z.object({
  id: z.string(),
  status: z.enum(CONVERSATION_STATUSES),
  title: z.string().nullable(),
  case_details: caseDetailsSchema,
  ticket: ticketRefSchema.nullable(),
  failed_article_ids: z.array(z.string()),
  read_only: z.boolean().describe("true para el admin que revisa la conversación de origen de un ticket"),
  created_at: isoDate,
  last_message_at: isoDate,
});
export type ConversationState = z.infer<typeof conversationStateSchema>;

export const conversationSchema = conversationStateSchema.extend({ messages: z.array(chatMessageSchema) });
export type Conversation = z.infer<typeof conversationSchema>;

// Paginada: el panel de conversaciones carga más con "Ver más".
export const conversationListSchema = paginatedSchema(conversationStateSchema);
export type ConversationList = z.infer<typeof conversationListSchema>;

export const sendMessageBodySchema = z.strictObject({
  text: z.string().trim().min(1).max(4000),
  // Adjuntos subidos antes a esta conversación (POST /support/conversations/:id/attachments).
  attachment_ids: z.array(z.uuid()).max(5).default([]),
  // Visión con consentimiento (AC-006.11): solo si la persona marca la casilla.
  share_images_with_ai: z.boolean().default(false),
});
// Tipo de entrada: attachment_ids y share_images_with_ai son opcionales al enviar.
export type SendMessageBody = z.input<typeof sendMessageBodySchema>;

export const resolutionBodySchema = z.strictObject({
  resolved: z.boolean(),
  article_id: z.uuid(),
});
export type ResolutionBody = z.infer<typeof resolutionBodySchema>;

export const escalateBodySchema = z.strictObject({
  note: z.string().trim().max(2000).optional(),
});
export type EscalateBody = z.infer<typeof escalateBodySchema>;

export const turnResponseSchema = z.object({
  user_message: chatMessageSchema.nullable(),
  assistant_message: chatMessageSchema,
  // true cuando el turno propuso una solución del catálogo: mostrar "¿Se resolvió?".
  ask_resolution: z.boolean(),
  conversation: conversationStateSchema,
});
export type TurnResponse = z.infer<typeof turnResponseSchema>;
