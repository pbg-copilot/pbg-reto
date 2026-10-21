import { z } from "zod";

// Métricas de atención y copiloto del equipo (specs/007-admin-metrics). Solo admin.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD");

export const metricsQuerySchema = z.object({
  from: day.optional().describe("Inicio del rango (incluido). Por defecto, hace 30 días"),
  to: day.optional().describe("Fin del rango (excluido). Por defecto, mañana"),
});

// Tiempos en segundos. null si no hay tickets en el rango que cumplan la condición.
const durationStats = z.object({
  count: z.number().int(),
  p50: z.number().nullable(),
  p90: z.number().nullable(),
  avg: z.number().nullable(),
});
export type DurationStats = z.infer<typeof durationStats>;

export const metricsSchema = z.object({
  range: z.object({ from: day, to: day }),
  total: z.number().int(),
  by_status: z.object({ open: z.number().int(), in_review: z.number().int(), closed: z.number().int() }),
  unattended: z.number().int().describe("Abiertos sin primera respuesta pública del equipo"),
  reopened: z.number().int(),
  reopen_rate: z.number().nullable().describe("Tickets reabiertos / tickets resueltos"),
  first_response: durationStats,
  resolution: durationStats,
  by_priority: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      count: z.number().int(),
      first_response_target_minutes: z.number().int().nullable(),
      resolution_target_minutes: z.number().int().nullable(),
      // % (0–100) con TPR/TR dentro del objetivo; null si no hay objetivo configurado.
      first_response_compliance: z.number().nullable(),
      resolution_compliance: z.number().nullable(),
    }),
  ),
  by_category: z.array(z.object({ code: z.string(), name: z.string(), count: z.number().int() })),
  ai: z.object({
    assistant_cost_usd: z.number(),
    copilot_cost_usd: z.number(),
    conversations: z.number().int(),
    cost_per_conversation_usd: z.number().nullable(),
  }),
});
export type Metrics = z.infer<typeof metricsSchema>;

export const updatePriorityBodySchema = z
  .strictObject({
    name: z.string().trim().min(2).max(40).optional(),
    rank: z.number().int().min(0).max(1000).optional(),
    first_response_target_minutes: z.number().int().min(1).max(60 * 24 * 60).nullable().optional(),
    resolution_target_minutes: z.number().int().min(1).max(60 * 24 * 180).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Envía al menos un campo");
export type UpdatePriorityBody = z.infer<typeof updatePriorityBodySchema>;

// Copiloto (solo admin). El modelo propone; el admin decide y envía.
export const copilotSummarySchema = z.object({ markdown: z.string() });
export const copilotDraftSchema = z.object({
  markdown: z.string(),
  articles: z.array(z.object({ slug: z.string(), title: z.string() })),
});
export type CopilotDraft = z.infer<typeof copilotDraftSchema>;
export const similarTicketsSchema = z.array(
  z.object({
    id: z.string(),
    display_number: z.string(),
    title: z.string(),
    status: z.enum(["open", "in_review", "closed"]),
    similarity: z.number(),
    created_at: z.string(),
  }),
);
export type SimilarTicket = z.infer<typeof similarTicketsSchema>[number];
