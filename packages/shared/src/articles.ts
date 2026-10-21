import { z } from "zod";
import { paginatedSchema, paginationQuerySchema } from "./pagination.js";

// Catálogo de problemas conocidos e incidentes (specs/003-catalog).

export const ARTICLE_STATUSES = ["draft", "published", "archived"] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];
export const articleStatusLabel: Record<ArticleStatus, string> = {
  draft: "Borrador",
  published: "Publicado",
  archived: "Archivado",
};

export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const incidentStatusLabel: Record<IncidentStatus, string> = {
  investigating: "En investigación",
  identified: "Causa identificada",
  monitoring: "En observación",
  resolved: "Resuelto",
};

export const EXAMPLE_NOTICE = "Ejemplo — no es un procedimiento oficial de PBG";

const isoDate = z.string().describe("Fecha ISO 8601 (UTC)");
const day = z.iso.date().describe("Fecha YYYY-MM-DD");

export const articleContentSchema = z.strictObject({
  title: z.string().trim().min(3).max(160),
  category: z.string().min(1).max(40),
  symptoms: z.string().trim().min(3).max(4000),
  applies_to: z.string().trim().max(200).default(""),
  diagnosis_steps: z.string().trim().min(3).max(8000),
  solution: z.string().trim().min(3).max(8000),
  escalation_conditions: z.string().trim().min(3).max(4000),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  reviewed_at: day.optional(),
  valid_until: day.nullable().optional(),
});
export type ArticleContent = z.input<typeof articleContentSchema>;

export const createArticleBodySchema = articleContentSchema.extend({
  is_example: z.boolean().default(false),
});
export type CreateArticleBody = z.input<typeof createArticleBodySchema>;

// base_version: versión sobre la que se editó. Si otro admin guardó una más nueva, 409.
export const newVersionBodySchema = articleContentSchema.extend({
  base_version: z.number().int().min(1),
});
export type NewVersionBody = z.input<typeof newVersionBodySchema>;

export const publishBodySchema = z.strictObject({ version_id: z.uuid() });

export const listArticlesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
  category: z.string().max(40).optional(),
  tag: z.string().max(30).optional(),
  status: z.enum(ARTICLE_STATUSES).optional().describe("Solo admin"),
});
export type ListArticlesQuery = z.input<typeof listArticlesQuerySchema>;
export type ListArticlesFilters = z.output<typeof listArticlesQuerySchema>;

export const articleVersionSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  title: z.string(),
  symptoms: z.string(),
  applies_to: z.string(),
  diagnosis_steps: z.string(),
  solution: z.string(),
  escalation_conditions: z.string(),
  tags: z.array(z.string()),
  reviewed_at: day,
  valid_until: day.nullable(),
  published_at: isoDate.nullable(),
  created_at: isoDate,
});
export type ArticleVersion = z.infer<typeof articleVersionSchema>;

export const articleSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  category: z.string(),
  status: z.enum(ARTICLE_STATUSES),
  is_example: z.boolean(),
  title: z.string(),
  symptoms: z.string(),
  tags: z.array(z.string()),
  reviewed_at: day,
  published_version: z.number().int().nullable(),
  latest_version: z.number().int(),
  updated_at: isoDate,
  url: z.string(),
});
export type ArticleSummary = z.infer<typeof articleSummarySchema>;

export const articleListSchema = paginatedSchema(articleSummarySchema);
export type ArticleList = z.infer<typeof articleListSchema>;

// Lectura (solicitante y admin): una versión concreta, publicada o publicada antes.
export const articleReaderSchema = z.object({
  id: z.string(),
  slug: z.string(),
  category: z.string(),
  status: z.enum(ARTICLE_STATUSES),
  is_example: z.boolean(),
  is_current: z.boolean().describe("Es la versión publicada vigente"),
  version: articleVersionSchema,
});
export type ArticleReader = z.infer<typeof articleReaderSchema>;

// Gestión (solo admin): todas las versiones y el ticket de origen.
export const articleManageSchema = articleSummarySchema.extend({
  versions: z.array(articleVersionSchema.extend({ created_by: z.string().nullable() })),
  source_ticket: z.object({ id: z.string(), display_number: z.string() }).nullable(),
});
export type ArticleManage = z.infer<typeof articleManageSchema>;

export const incidentBodySchema = z.strictObject({
  title: z.string().trim().min(3).max(160),
  public_summary: z.string().trim().min(3).max(2000),
  status: z.enum(INCIDENT_STATUSES).default("investigating"),
  category: z.string().max(40).nullable().optional(),
  article_id: z.uuid().nullable().optional(),
});
export type IncidentBody = z.input<typeof incidentBodySchema>;

export const updateIncidentBodySchema = incidentBodySchema.partial();

// Proyección pública: nunca incluye tickets ni datos de solicitantes.
export const incidentSchema = z.object({
  id: z.string(),
  title: z.string(),
  public_summary: z.string(),
  status: z.enum(INCIDENT_STATUSES),
  category: z.string().nullable(),
  article: z.object({ slug: z.string(), title: z.string() }).nullable(),
  started_at: isoDate,
  resolved_at: isoDate.nullable(),
  // Solo admin.
  linked_tickets: z.number().int().optional(),
});
export type Incident = z.infer<typeof incidentSchema>;

export const listIncidentsQuerySchema = paginationQuerySchema.extend({
  active: z.enum(["true", "false"]).optional().describe("true: solo los no resueltos"),
});
export const incidentListSchema = paginatedSchema(incidentSchema);
export type IncidentList = z.infer<typeof incidentListSchema>;
