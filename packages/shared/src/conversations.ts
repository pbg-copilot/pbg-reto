import { z } from "zod";

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

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  kind: z.enum(["message", "resolution_feedback", "notice"]),
  text: z.string(),
  article_refs: z.array(articleRefSchema),
  ticket_ref: ticketRefSchema.nullable(),
  // Avisos del sistema: el asistente no respondió, se ocultó un dato sensible…
  notice: z.enum(["assistant_unavailable", "secret_redacted"]).nullable(),
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

export const conversationListSchema = z.array(conversationStateSchema);

export const sendMessageBodySchema = z.strictObject({
  text: z.string().trim().min(1).max(4000),
});
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;

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
