import { z } from "zod";

// Métricas de atención y copiloto del equipo (specs/007-admin-metrics). Solo admin.

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD");

export const METRIC_GROUPS = ["day", "week", "month"] as const;
export type MetricGroup = (typeof METRIC_GROUPS)[number];
export const metricGroupLabel: Record<MetricGroup, string> = { day: "Día", week: "Semana", month: "Mes" };

export const metricsQuerySchema = z.object({
  from: day.optional().describe("Inicio del rango (incluido). Por defecto, hace 30 días"),
  to: day.optional().describe("Fin del rango (excluido). Por defecto, mañana"),
  group: z.enum(METRIC_GROUPS).default("day").describe("Agrupación de la serie: día, semana (desde el lunes) o mes"),
});
export type MetricsQuery = z.input<typeof metricsQuerySchema>;

// Tiempos en segundos. null si no hay tickets en el rango que cumplan la condición.
const durationStats = z.object({
  count: z.number().int(),
  p50: z.number().nullable(),
  p90: z.number().nullable(),
  avg: z.number().nullable(),
});
export type DurationStats = z.infer<typeof durationStats>;

const seriesPointSchema = z.object({
  bucket: day.describe("Inicio del periodo"),
  created: z.number().int(),
  closed: z.number().int(),
  reopened: z.number().int().describe("Reaperturas ocurridas en el periodo"),
  first_response_p50: z.number().nullable().describe("Mediana de TPR (segundos) de los tickets creados en el periodo"),
  resolution_p50: z.number().nullable().describe("Mediana de TR (segundos) de los tickets creados en el periodo"),
  conversations: z.number().int(),
  resolved_without_ticket: z.number().int(),
  escalated: z.number().int(),
  ai_cost_usd: z.number().describe("Chat + copiloto"),
});
export type SeriesPoint = z.infer<typeof seriesPointSchema>;

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
    copilot_uses: z.number().int(),
  }),
  // Tickets creados y cerrados por día (UTC) dentro del rango.
  trend: z.array(z.object({ day, created: z.number().int(), closed: z.number().int() })),
  // Serie por periodo para el gráfico con métrica a elegir (AC-007.18). Solo cuenta lo que
  // ocurrió dentro de [from, to); el primer periodo puede empezar antes de `from`.
  series: z.object({
    group: z.enum(METRIC_GROUPS),
    points: z.array(seriesPointSchema),
  }),
  // Eficacia del asistente sobre las conversaciones iniciadas en el rango.
  assistant: z.object({
    conversations: z.number().int(),
    resolved_without_ticket: z.number().int(),
    escalated: z.number().int(),
    deflection_rate: z.number().nullable().describe("% resueltas por el asistente sin ticket, sobre las que terminaron (resueltas + escaladas)"),
    escalation_reasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
    top_articles: z.array(z.object({ article_id: z.string(), title: z.string(), uses: z.number().int() })),
    failed_articles: z.array(z.object({ article_id: z.string(), title: z.string(), failures: z.number().int() })),
  }),
});
export type Metrics = z.infer<typeof metricsSchema>;

// Estado operativo en vivo (no depende del rango): qué necesita atención ahora.
const attentionItem = z.object({
  id: z.string(),
  display_number: z.string(),
  title: z.string(),
  priority: z.string(),
  priority_code: z.string().describe("Código de la prioridad (criticidad) para su color"),
  since: z.string().describe("Desde cuándo espera (ISO 8601)"),
  assignee: z.string().nullable(),
});
export type AttentionItem = z.infer<typeof attentionItem>;
const attentionList = z.object({ count: z.number().int(), items: z.array(attentionItem) });

export const operationsSchema = z.object({
  unattended: attentionList.describe("Abiertos sin respuesta pública del equipo, del más antiguo al más nuevo"),
  waiting_team: attentionList.describe("El solicitante respondió y el equipo todavía no"),
  waiting_requester: attentionList.describe("El equipo pidió información y el solicitante no respondió"),
  aging: z.object({ under_24h: z.number().int(), d1_3: z.number().int(), d3_7: z.number().int(), over_7d: z.number().int() }),
  workload: z.array(z.object({ id: z.string(), name: z.string(), open: z.number().int(), in_review: z.number().int() })),
  unassigned: z.number().int(),
  health: z.object({
    failed_deliveries_7d: z.number().int(),
    pending_deliveries: z.number().int(),
    active_incidents: z.number().int(),
    tickets_in_active_incidents: z.number().int(),
  }),
});
export type Operations = z.infer<typeof operationsSchema>;

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
