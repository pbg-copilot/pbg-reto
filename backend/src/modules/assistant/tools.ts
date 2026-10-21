import type Anthropic from "@anthropic-ai/sdk";
import { sql } from "kysely";
import { z } from "zod";
import {
  CASE_FIELDS,
  ESCALATION_REASONS,
  IMPACTS,
  TICKET_STATUSES,
  type Agent,
  type ArticleRef,
  type EscalationReason,
  type Impact,
  type TicketRef,
  type TicketStatus,
} from "@reto/shared";
import type { Database } from "../../db/kysely.js";
import { articleUrl, isUsableSql } from "../articles/service.js";
import { searchCondition, searchRank } from "../articles/search.js";
import { wrapUntrusted } from "./guards.js";

// Herramientas limitadas (§11). El modelo nunca envía identidades ni privilegios: el actor sale
// de la sesión y cada input se valida con zod en el servidor. No hay herramientas para cambiar
// estados, cerrar tickets ni leer casos ajenos.

// Categorías sembradas (002). Fijas en el esquema para que el prefijo de tools sea cacheable.
const CATEGORY_CODES = ["access", "permissions", "screens", "uploads", "unexpected", "other"] as const;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });

// Esquemas para la API (modo estricto: sin minLength/maxLength; los límites los valida zod).
export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_articles",
    description:
      "Busca en el catálogo de problemas conocidos (solo artículos publicados y vigentes) y en los incidentes activos. Úsala antes de proponer cualquier solución.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Síntomas en palabras de la persona" },
        category: nullable({ type: "string", enum: [...CATEGORY_CODES] }),
      },
      required: ["query", "category"],
      additionalProperties: false,
    },
  },
  {
    name: "get_article",
    description: "Lee la versión publicada de un artículo del catálogo (pasos de diagnóstico, solución y cuándo escalar).",
    strict: true,
    input_schema: {
      type: "object",
      properties: { article_id: { type: "string", description: "article_id devuelto por search_articles" } },
      required: ["article_id"],
      additionalProperties: false,
    },
  },
  {
    name: "update_case_details",
    description: "Registra los datos del caso que ya conoces. Usa null para lo que todavía no sabes.",
    strict: true,
    input_schema: {
      type: "object",
      properties: Object.fromEntries(CASE_FIELDS.map((field) => [field, nullable({ type: "string" })])),
      required: [...CASE_FIELDS],
      additionalProperties: false,
    },
  },
  {
    name: "create_ticket",
    description:
      "Crea un ticket para el equipo de soporte con el contexto de la conversación. El solicitante es siempre la persona de esta conversación. Devuelve el número real del ticket.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Resumen corto del problema (máx. 120 caracteres)" },
        reported_symptom: { type: "string", description: "Lo que la persona reporta, sin afirmar causas" },
        category: { type: "string", enum: [...CATEGORY_CODES] },
        impact: { type: "string", enum: [...IMPACTS] },
        reason: { type: "string", enum: [...ESCALATION_REASONS] },
        attempted_steps: {
          type: "array",
          items: {
            type: "object",
            properties: { step: { type: "string" }, result: { type: "string" } },
            required: ["step", "result"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "reported_symptom", "category", "impact", "reason", "attempted_steps"],
      additionalProperties: false,
    },
  },
  {
    name: "get_my_account_status",
    description:
      "Consulta el estado de la cuenta de la persona de esta conversación (solo lectura): rol, estado de la cuenta, si pertenece a una agencia y su sesión actual, más las reglas de sesión de la plataforma. Úsala ante problemas de acceso, de sesión que se cierra o de permisos, antes de explicar la causa. No repara nada.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "get_my_tickets",
    description: "Consulta los tickets de la persona de esta conversación (nunca los de otras personas).",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        number: nullable({ type: "integer", description: "Número del ticket sin el prefijo TCK-" }),
        status: nullable({ type: "string", enum: [...TICKET_STATUSES] }),
      },
      required: ["number", "status"],
      additionalProperties: false,
    },
  },
];

const text = (max: number) => z.string().trim().min(1).max(max);
const validators = {
  search_articles: z.strictObject({ query: text(200), category: z.enum(CATEGORY_CODES).nullable() }),
  get_article: z.strictObject({ article_id: z.uuid() }),
  update_case_details: z.strictObject(
    Object.fromEntries(CASE_FIELDS.map((field) => [field, z.string().trim().max(300).nullable()])) as Record<
      (typeof CASE_FIELDS)[number],
      z.ZodNullable<z.ZodString>
    >,
  ),
  create_ticket: z.strictObject({
    title: z.string().trim().min(3).max(160),
    reported_symptom: text(2000),
    category: z.enum(CATEGORY_CODES),
    impact: z.enum(IMPACTS),
    reason: z.enum(ESCALATION_REASONS),
    attempted_steps: z.array(z.strictObject({ step: text(300), result: text(300) })).max(10),
  }),
  get_my_account_status: z.strictObject({}),
  get_my_tickets: z.strictObject({
    number: z.number().int().min(1).nullable(),
    status: z.enum(TICKET_STATUSES).nullable(),
  }),
};

export type ToolName = keyof typeof validators;

export type EscalationInput = {
  title: string;
  reportedSymptom: string;
  category: string;
  impact: Impact;
  reason: EscalationReason;
  attemptedSteps: { step: string; result: string }[];
};

export type TurnState = {
  articleRefs: ArticleRef[];
  ticketRef: TicketRef | null;
  // Incidentes activos que vio este turno: el ticket que se cree queda vinculado.
  incidents: { id: string; category: string | null }[];
  // Datos reales que respaldan la respuesta (AC-009.2): la UI lo muestra.
  evidence: "account_status"[];
};

export type ToolContext = {
  db: Database;
  actor: Agent;
  conversationId: string;
  failedArticleIds: string[];
  state: TurnState;
  escalate: (input: EscalationInput) => Promise<TicketRef>;
  myTickets: (number: number | null, status: TicketStatus | null) => Promise<unknown[]>;
  sessionHours: number;
};

export type ToolResult = { content: string; isError: boolean };

const fail = (code: string, message: string): ToolResult => ({ content: wrapUntrusted({ error: code, message }), isError: true });

export async function executeTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResult> {
  if (!(name in validators)) return fail("unknown_tool", "Herramienta no disponible.");
  const parsed = validators[name as ToolName].safeParse(rawInput);
  if (!parsed.success) return fail("invalid_input", "Los datos de la herramienta no son válidos. Revisa los campos y vuelve a intentar.");
  const input = parsed.data as never;
  switch (name as ToolName) {
    case "search_articles":
      return searchArticles(input, ctx);
    case "get_article":
      return getArticle(input, ctx);
    case "update_case_details":
      return updateCaseDetails(input, ctx);
    case "create_ticket":
      return createTicket(input, ctx);
    case "get_my_tickets":
      return getMyTickets(input, ctx);
    case "get_my_account_status":
      return getMyAccountStatus(ctx);
  }
}

async function searchArticles({ query, category }: z.infer<typeof validators.search_articles>, ctx: ToolContext) {
  const { rows } = await sql<{ article_id: string; version: number; title: string; symptoms: string; applies_to: string; is_example: boolean }>`
    SELECT a.id AS article_id, v.version, v.title, v.symptoms, v.applies_to, a.is_example
    FROM helpdesk.articles a JOIN helpdesk.article_versions v ON v.id = a.published_version_id
    WHERE ${isUsableSql} AND ${searchCondition(query)} ${category ? sql`AND a.category_code = ${category}` : sql``}
    ORDER BY ${searchRank(query)} DESC
    LIMIT 3
  `.execute(ctx.db);
  const incidents = await ctx.db
    .selectFrom("helpdesk.incidents")
    .select(["id", "title", "public_summary", "status", "category_code"])
    .where("status", "<>", "resolved")
    .$if(Boolean(category), (qb) => qb.where((eb) => eb.or([eb("category_code", "=", category!), eb("category_code", "is", null)])))
    .execute();
  for (const incident of incidents) ctx.state.incidents.push({ id: incident.id, category: incident.category_code });
  return {
    isError: false,
    content: wrapUntrusted({
      articles: rows.map((row) => ({
        article_id: row.article_id,
        title: row.title,
        symptoms: row.symptoms.slice(0, 300),
        applies_to: row.applies_to,
        is_example: row.is_example,
        already_failed: ctx.failedArticleIds.includes(row.article_id),
      })),
      active_incidents: incidents.map((incident) => ({
        title: incident.title,
        status: incident.status,
        public_summary: incident.public_summary,
      })),
    }),
  };
}

async function getArticle({ article_id }: z.infer<typeof validators.get_article>, ctx: ToolContext) {
  if (ctx.failedArticleIds.includes(article_id))
    return fail("already_tried", "La persona ya probó este artículo y no funcionó. No lo vuelvas a sugerir.");
  const row = await ctx.db
    .selectFrom("helpdesk.articles as a")
    .innerJoin("helpdesk.article_versions as v", "v.id", "a.published_version_id")
    .select(["a.id", "a.slug", "a.is_example", "a.status", "v.id as version_id", "v.version", "v.title", "v.diagnosis_steps", "v.solution", "v.escalation_conditions", "v.valid_until"])
    .where("a.id", "=", article_id)
    .executeTakeFirst();
  const usable = row && row.status === "published" && (!row.valid_until || row.valid_until >= new Date().toISOString().slice(0, 10));
  if (!row || !usable) return fail("not_found", "El artículo no existe o no está publicado.");
  const ref: ArticleRef = {
    article_id: row.id,
    version_id: row.version_id,
    version: row.version,
    slug: row.slug,
    title: row.title,
    url: articleUrl(row.slug, row.version),
    is_example: row.is_example,
  };
  if (!ctx.state.articleRefs.some((existing) => existing.version_id === ref.version_id)) ctx.state.articleRefs.push(ref);
  return {
    isError: false,
    content: wrapUntrusted({
      title: row.title,
      is_example: row.is_example,
      diagnosis_steps: row.diagnosis_steps,
      solution: row.solution,
      escalation_conditions: row.escalation_conditions,
    }),
  };
}

async function updateCaseDetails(input: z.infer<typeof validators.update_case_details>, ctx: ToolContext) {
  const known = Object.fromEntries(Object.entries(input).filter(([, value]) => value));
  const updated = await ctx.db
    .updateTable("helpdesk.conversations")
    .set({ case_details: sql`case_details || ${JSON.stringify(known)}::jsonb`, updated_at: sql`now()` })
    .where("id", "=", ctx.conversationId)
    .returning("case_details")
    .executeTakeFirstOrThrow();
  const details = updated.case_details as Record<string, string>;
  return {
    isError: false,
    content: wrapUntrusted({ case_details: details, missing: CASE_FIELDS.filter((field) => !details[field]) }),
  };
}

async function createTicket(input: z.infer<typeof validators.create_ticket>, ctx: ToolContext) {
  const ticket = await ctx.escalate({
    title: input.title,
    reportedSymptom: input.reported_symptom,
    category: input.category,
    impact: input.impact,
    reason: input.reason,
    attemptedSteps: input.attempted_steps,
  });
  ctx.state.ticketRef = ticket;
  return {
    isError: false,
    content: wrapUntrusted({ display_number: ticket.display_number, title: ticket.title, status: "Abierto", url: ticket.url }),
  };
}

async function getMyTickets({ number, status }: z.infer<typeof validators.get_my_tickets>, ctx: ToolContext) {
  const tickets = await ctx.myTickets(number, status);
  return { isError: false, content: wrapUntrusted({ tickets }) };
}

const ROLE_LABEL: Record<string, string> = {
  agent: "Agente",
  agency_owner: "Dueño de agencia",
  admin: "Administrador de soporte",
  appeal_officer: "Oficial de apelaciones",
};
const ACCOUNT_STATUS_LABEL: Record<string, string> = { active: "activa", suspended: "suspendida", cancelled: "cancelada" };

// Diagnóstico de la propia cuenta (AC-009.1). Proyección mínima: solo etiquetas y la sesión
// que crea nuestro login. No lee el historial de accesos (datos reales con IP y ubicación) ni
// nombres, correos o facturación.
async function getMyAccountStatus(ctx: ToolContext) {
  const [agent, account, session] = await Promise.all([
    ctx.db.selectFrom("reto.agents").select(["role", "agency_id"]).where("id", "=", ctx.actor.id).executeTakeFirst(),
    ctx.db.selectFrom("onboarding.accounts").select(["status"]).where("id", "=", ctx.actor.id).executeTakeFirst(),
    ctx.db.selectFrom("reto.sessions").select(["created_at", "expires_at"]).where("agent_id", "=", ctx.actor.id).executeTakeFirst(),
  ]);
  ctx.state.evidence = [...new Set([...ctx.state.evidence, "account_status" as const])];
  const role = agent?.role ?? ctx.actor.role;
  const minutesLeft = session ? Math.max(0, Math.round((new Date(session.expires_at).getTime() - Date.now()) / 60000)) : null;
  return {
    isError: false,
    content: wrapUntrusted({
      role: ROLE_LABEL[role] ?? "Otro",
      account_status: ACCOUNT_STATUS_LABEL[account?.status ?? ""] ?? "desconocido",
      agency: { member: Boolean(agent?.agency_id), owner: role === "agency_owner" },
      current_session: session
        ? { started_at: new Date(session.created_at).toISOString(), expires_at: new Date(session.expires_at).toISOString(), minutes_left: minutesLeft }
        : null,
      platform_rules: [
        "Hay una sola sesión activa por cuenta: iniciar sesión en otro dispositivo o navegador cierra la sesión anterior.",
        `La sesión dura ${ctx.sessionHours} horas; al vencer hay que volver a iniciar sesión.`,
        "Ser dueño de una agencia no da acceso a los tickets de sus agentes.",
        "Una cuenta suspendida o cancelada no puede iniciar sesión; la revisa el equipo de soporte, el asistente no la puede reactivar.",
      ],
    }),
  };
}
