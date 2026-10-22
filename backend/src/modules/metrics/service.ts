import { sql } from "kysely";
import { closureReasonLabel, displayNumber, statusLabel, type AttentionItem, type MetricGroup, type Metrics, type Operations, type SeriesPoint } from "@reto/shared";
import type { Database } from "../../db/kysely.js";
import { AppError } from "../../lib/errors.js";
import { buildXlsx, type Sheet } from "../../lib/xlsx.js";
import { costUsd } from "../assistant/pricing.js";

// Fórmulas de specs/007-admin-metrics/spec.md, sobre los tickets creados en [from, to) en UTC.
// - TPR: first_response_at − created_at (primer comentario público del equipo; las notas
//   internas, los cambios de estado y la asignación no cuentan). No se recalcula al reabrir.
// - TR: closed_at − created_at de los cerrados como resueltos. closed_at es el último cierre:
//   reabrir alarga el TR.
// - Cumplimiento: % de tickets (con TPR o TR) dentro del objetivo de su prioridad; null si la
//   prioridad no tiene objetivo.

const DAY = 86_400_000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export function resolveRange(from?: string, to?: string) {
  const end = to ?? isoDay(new Date(Date.now() + DAY));
  const start = from ?? isoDay(new Date(new Date(`${end}T00:00:00Z`).getTime() - 30 * DAY));
  const span = (new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) / DAY;
  if (!(span > 0)) throw new AppError(400, "invalid_request", "La fecha de inicio debe ser anterior a la de fin.");
  if (span > 366) throw new AppError(400, "invalid_request", "El rango máximo es de un año.");
  return { from: start, to: end };
}

type Summary = {
  total: number;
  open: number;
  in_review: number;
  closed: number;
  unattended: number;
  reopened: number;
  resolved: number;
  frt_count: number;
  frt_p50: number | null;
  frt_p90: number | null;
  frt_avg: number | null;
  rt_count: number;
  rt_p50: number | null;
  rt_p90: number | null;
  rt_avg: number | null;
};

type UsageRow = { model: string | null; input: string | null; output: string | null; cache_read: string | null; cache_write: string | null };
const toCost = (rows: UsageRow[]) =>
  rows.reduce(
    (sum, row) =>
      sum +
      costUsd(row.model ?? "", {
        input_tokens: Number(row.input ?? 0),
        output_tokens: Number(row.output ?? 0),
        cache_read_input_tokens: Number(row.cache_read ?? 0),
        cache_creation_input_tokens: Number(row.cache_write ?? 0),
      }),
    0,
  );
const round = (value: number | null, digits = 1) => (value === null ? null : Number(value.toFixed(digits)));

type Range = { from: string; to: string };
type UsageByBucket = UsageRow & { bucket: string };

// Serie por periodo (AC-007.18). `group` viene validado por zod (day | week | month), por eso
// puede ir como literal. Cada métrica cuenta lo ocurrido dentro de [from, to).
async function series(db: Database, range: Range, group: MetricGroup): Promise<SeriesPoint[]> {
  const unit = sql.lit(group);
  const step = sql.raw(`interval '1 ${group}'`);
  const within = (column: string) => sql`${sql.ref(column)} >= ${range.from}::date AND ${sql.ref(column)} < ${range.to}::date`;
  const bucketOf = (column: string) => sql`date_trunc(${unit}, ${sql.ref(column)})::date`;
  const [counts, usage] = await Promise.all([
    sql<Omit<SeriesPoint, "ai_cost_usd"> & { first_response_p50: number | null; resolution_p50: number | null }>`
      WITH buckets AS (
        SELECT b::date AS bucket
        FROM generate_series(date_trunc(${unit}, ${range.from}::date::timestamp), (${range.to}::date - 1)::timestamp, ${step}) AS b
      ),
      created AS (
        SELECT ${bucketOf("created_at")} AS bucket, count(*)::int AS created,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN first_response_at IS NOT NULL THEN extract(epoch FROM first_response_at - created_at)::float8 END) AS frt,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY CASE WHEN status = 'closed' AND closure_reason = 'resolved' THEN extract(epoch FROM closed_at - created_at)::float8 END) AS rt
        FROM helpdesk.tickets WHERE ${within("created_at")} GROUP BY 1
      ),
      closed AS (SELECT ${bucketOf("closed_at")} AS bucket, count(*)::int AS closed FROM helpdesk.tickets WHERE ${within("closed_at")} GROUP BY 1),
      reopened AS (
        SELECT ${bucketOf("created_at")} AS bucket, count(*)::int AS reopened
        FROM helpdesk.ticket_events WHERE type = 'reopened' AND ${within("created_at")} GROUP BY 1
      ),
      conv AS (
        SELECT ${bucketOf("created_at")} AS bucket, count(*)::int AS conversations,
          count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
          count(*) FILTER (WHERE status = 'escalated')::int AS escalated
        FROM helpdesk.conversations WHERE ${within("created_at")} GROUP BY 1
      )
      SELECT to_char(b.bucket, 'YYYY-MM-DD') AS bucket,
        coalesce(created.created, 0) AS created, coalesce(closed.closed, 0) AS closed, coalesce(reopened.reopened, 0) AS reopened,
        created.frt AS first_response_p50, created.rt AS resolution_p50,
        coalesce(conv.conversations, 0) AS conversations, coalesce(conv.resolved, 0) AS resolved_without_ticket, coalesce(conv.escalated, 0) AS escalated
      FROM buckets b
      LEFT JOIN created USING (bucket) LEFT JOIN closed USING (bucket) LEFT JOIN reopened USING (bucket) LEFT JOIN conv USING (bucket)
      ORDER BY b.bucket
    `.execute(db),
    // Costo de IA por periodo y modelo (chat + copiloto); el precio se aplica en JS.
    sql<UsageByBucket>`
      SELECT to_char(${bucketOf("created_at")}, 'YYYY-MM-DD') AS bucket, model,
        sum((usage->>'input_tokens')::bigint) AS input, sum((usage->>'output_tokens')::bigint) AS output,
        sum((usage->>'cache_read_input_tokens')::bigint) AS cache_read, sum((usage->>'cache_creation_input_tokens')::bigint) AS cache_write
      FROM helpdesk.conversation_messages WHERE usage IS NOT NULL AND ${within("created_at")} GROUP BY 1, 2
      UNION ALL
      SELECT to_char(${bucketOf("created_at")}, 'YYYY-MM-DD') AS bucket, model,
        sum((usage->>'input_tokens')::bigint), sum((usage->>'output_tokens')::bigint),
        sum((usage->>'cache_read_input_tokens')::bigint), sum((usage->>'cache_creation_input_tokens')::bigint)
      FROM helpdesk.ai_usage WHERE ${within("created_at")} GROUP BY 1, 2
    `.execute(db),
  ]);
  const cost = new Map<string, number>();
  for (const row of usage.rows) cost.set(row.bucket, (cost.get(row.bucket) ?? 0) + toCost([row]));
  return counts.rows.map((row) => ({
    ...row,
    first_response_p50: round(row.first_response_p50 === null ? null : Number(row.first_response_p50), 0),
    resolution_p50: round(row.resolution_p50 === null ? null : Number(row.resolution_p50), 0),
    ai_cost_usd: Number((cost.get(row.bucket) ?? 0).toFixed(6)),
  }));
}

const SOURCE_LABEL: Record<string, string> = { assistant: "Asistente", manual_form: "Formulario", human_request: "Pidió una persona" };
const EXPORT_MAX_TICKETS = 20_000;
const minutes = (seconds: number | null) => (seconds === null ? null : Math.round(seconds / 60));
const hours = (seconds: number | null) => (seconds === null ? null : Number((seconds / 3600).toFixed(1)));

export function createMetricsService(db: Database) {
  return {
    async metrics(range: Range, group: MetricGroup = "day"): Promise<Metrics> {
      const inRange = sql`t.created_at >= ${range.from}::date AND t.created_at < ${range.to}::date`;
      const { rows: summaryRows } = await sql<Summary>`
        WITH t AS (SELECT * FROM helpdesk.tickets t WHERE ${inRange}),
        frt AS (SELECT extract(epoch FROM first_response_at - created_at)::float8 AS s FROM t WHERE first_response_at IS NOT NULL),
        rt AS (SELECT extract(epoch FROM closed_at - created_at)::float8 AS s FROM t WHERE status = 'closed' AND closure_reason = 'resolved')
        SELECT
          (SELECT count(*)::int FROM t) AS total,
          (SELECT count(*)::int FROM t WHERE status = 'open') AS open,
          (SELECT count(*)::int FROM t WHERE status = 'in_review') AS in_review,
          (SELECT count(*)::int FROM t WHERE status = 'closed') AS closed,
          (SELECT count(*)::int FROM t WHERE status = 'open' AND first_response_at IS NULL) AS unattended,
          (SELECT count(*)::int FROM t WHERE reopened_count > 0) AS reopened,
          (SELECT count(*)::int FROM rt) AS resolved,
          (SELECT count(*)::int FROM frt) AS frt_count,
          (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s) FROM frt) AS frt_p50,
          (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY s) FROM frt) AS frt_p90,
          (SELECT avg(s) FROM frt) AS frt_avg,
          (SELECT count(*)::int FROM rt) AS rt_count,
          (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s) FROM rt) AS rt_p50,
          (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY s) FROM rt) AS rt_p90,
          (SELECT avg(s) FROM rt) AS rt_avg
      `.execute(db);
      const s = summaryRows[0]!;

      const { rows: priorities } = await sql<{
        code: string;
        name: string;
        count: number;
        frt_target: number | null;
        rt_target: number | null;
        frt_compliance: number | null;
        rt_compliance: number | null;
      }>`
        SELECT p.code, p.name, p.first_response_target_minutes AS frt_target, p.resolution_target_minutes AS rt_target,
          count(t.id)::int AS count,
          CASE WHEN p.first_response_target_minutes IS NULL THEN NULL ELSE
            100.0 * count(*) FILTER (WHERE t.first_response_at - t.created_at <= make_interval(mins => p.first_response_target_minutes))
              / NULLIF(count(*) FILTER (WHERE t.first_response_at IS NOT NULL), 0) END::float8 AS frt_compliance,
          CASE WHEN p.resolution_target_minutes IS NULL THEN NULL ELSE
            100.0 * count(*) FILTER (WHERE t.status = 'closed' AND t.closure_reason = 'resolved' AND t.closed_at - t.created_at <= make_interval(mins => p.resolution_target_minutes))
              / NULLIF(count(*) FILTER (WHERE t.status = 'closed' AND t.closure_reason = 'resolved'), 0) END::float8 AS rt_compliance
        FROM helpdesk.priorities p
        LEFT JOIN helpdesk.tickets t ON t.priority_code = p.code AND ${inRange}
        WHERE p.is_active
        GROUP BY p.code, p.name, p.rank, p.first_response_target_minutes, p.resolution_target_minutes
        ORDER BY p.rank
      `.execute(db);

      const { rows: categories } = await sql<{ code: string; name: string; count: number }>`
        SELECT c.code, c.name, count(t.id)::int AS count
        FROM helpdesk.categories c
        LEFT JOIN helpdesk.tickets t ON t.category_code = c.code AND ${inRange}
        WHERE c.is_active
        GROUP BY c.code, c.name, c.sort
        ORDER BY c.sort
      `.execute(db);

      // Costo de IA: chat (usage de cada respuesta) y copiloto (ai_usage), por modelo.
      const usageSum = (column: string) => sql.raw(`sum((usage->>'${column}')::bigint)`);
      const messageWindow = sql`created_at >= ${range.from}::date AND created_at < ${range.to}::date`;
      // Tendencia diaria, eficacia del asistente y usos del copiloto en el mismo rango.
      const [trend, assistant, escalations, topArticles, failedArticles, copilotUses, points] = await Promise.all([
        // Dos agregados agrupados por día (no una subconsulta por día): ~14 ms con 20.000 tickets.
        sql<{ day: string; created: number; closed: number }>`
          WITH days AS (SELECT d::date AS day FROM generate_series(${range.from}::date, ${range.to}::date - 1, interval '1 day') AS d),
          created AS (
            SELECT created_at::date AS day, count(*)::int AS n FROM helpdesk.tickets
            WHERE created_at >= ${range.from}::date AND created_at < ${range.to}::date GROUP BY 1
          ),
          closed AS (
            SELECT closed_at::date AS day, count(*)::int AS n FROM helpdesk.tickets
            WHERE closed_at >= ${range.from}::date AND closed_at < ${range.to}::date GROUP BY 1
          )
          SELECT to_char(days.day, 'YYYY-MM-DD') AS day, coalesce(created.n, 0) AS created, coalesce(closed.n, 0) AS closed
          FROM days LEFT JOIN created USING (day) LEFT JOIN closed USING (day)
          ORDER BY days.day
        `.execute(db),
        sql<{ conversations: number; resolved: number; escalated: number }>`
          SELECT count(*)::int AS conversations,
                 count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
                 count(*) FILTER (WHERE status = 'escalated')::int AS escalated
          FROM helpdesk.conversations WHERE ${messageWindow}
        `.execute(db),
        sql<{ reason: string; count: number }>`
          SELECT coalesce(t.ai_summary->>'reason', 'other') AS reason, count(*)::int AS count
          FROM helpdesk.conversations c JOIN helpdesk.tickets t ON t.id = c.ticket_id
          WHERE c.created_at >= ${range.from}::date AND c.created_at < ${range.to}::date
          GROUP BY 1 ORDER BY 2 DESC
        `.execute(db),
        sql<{ article_id: string; title: string; uses: number }>`
          SELECT ref->>'article_id' AS article_id, max(ref->>'title') AS title, count(*)::int AS uses
          FROM helpdesk.conversation_messages m, jsonb_array_elements(m.article_refs) AS ref
          WHERE m.created_at >= ${range.from}::date AND m.created_at < ${range.to}::date
          GROUP BY 1 ORDER BY 3 DESC LIMIT 5
        `.execute(db),
        sql<{ article_id: string; title: string; failures: number }>`
          SELECT f.article_id::text AS article_id, coalesce(max(v.title), 'Artículo') AS title, count(*)::int AS failures
          FROM helpdesk.conversations c, unnest(c.failed_article_ids) AS f(article_id)
          LEFT JOIN helpdesk.articles a ON a.id = f.article_id
          LEFT JOIN helpdesk.article_versions v ON v.id = a.published_version_id
          WHERE c.created_at >= ${range.from}::date AND c.created_at < ${range.to}::date
          GROUP BY 1 ORDER BY 3 DESC LIMIT 5
        `.execute(db),
        sql<{ n: number }>`SELECT count(*)::int AS n FROM helpdesk.ai_usage WHERE ${messageWindow}`.execute(db),
        series(db, range, group),
      ]);
      const a = assistant.rows[0]!;
      const finished = a.resolved + a.escalated;

      const [chat, copilot, conversations] = await Promise.all([
        sql<UsageRow>`
          SELECT model, ${usageSum("input_tokens")} AS input, ${usageSum("output_tokens")} AS output,
                 ${usageSum("cache_read_input_tokens")} AS cache_read, ${usageSum("cache_creation_input_tokens")} AS cache_write
          FROM helpdesk.conversation_messages WHERE usage IS NOT NULL AND ${messageWindow} GROUP BY model
        `.execute(db),
        sql<UsageRow>`
          SELECT model, ${usageSum("input_tokens")} AS input, ${usageSum("output_tokens")} AS output,
                 ${usageSum("cache_read_input_tokens")} AS cache_read, ${usageSum("cache_creation_input_tokens")} AS cache_write
          FROM helpdesk.ai_usage WHERE ${messageWindow} GROUP BY model
        `.execute(db),
        sql<{ n: number }>`
          SELECT count(DISTINCT conversation_id)::int AS n FROM helpdesk.conversation_messages WHERE usage IS NOT NULL AND ${messageWindow}
        `.execute(db),
      ]);
      const assistantCost = toCost(chat.rows);
      const conversationCount = conversations.rows[0]?.n ?? 0;

      const stats = (count: number, p50: number | null, p90: number | null, avg: number | null) => ({
        count,
        p50: round(p50 === null ? null : Number(p50), 0),
        p90: round(p90 === null ? null : Number(p90), 0),
        avg: round(avg === null ? null : Number(avg), 0),
      });

      return {
        range,
        total: s.total,
        by_status: { open: s.open, in_review: s.in_review, closed: s.closed },
        unattended: s.unattended,
        reopened: s.reopened,
        reopen_rate: s.resolved > 0 ? round((100 * s.reopened) / s.resolved) : null,
        first_response: stats(s.frt_count, s.frt_p50, s.frt_p90, s.frt_avg),
        resolution: stats(s.rt_count, s.rt_p50, s.rt_p90, s.rt_avg),
        by_priority: priorities.map((row) => ({
          code: row.code,
          name: row.name,
          count: row.count,
          first_response_target_minutes: row.frt_target,
          resolution_target_minutes: row.rt_target,
          first_response_compliance: round(row.frt_compliance),
          resolution_compliance: round(row.rt_compliance),
        })),
        by_category: categories,
        ai: {
          assistant_cost_usd: Number(assistantCost.toFixed(6)),
          copilot_cost_usd: Number(toCost(copilot.rows).toFixed(6)),
          conversations: conversationCount,
          cost_per_conversation_usd: conversationCount ? Number((assistantCost / conversationCount).toFixed(6)) : null,
          copilot_uses: copilotUses.rows[0]?.n ?? 0,
        },
        trend: trend.rows,
        series: { group, points },
        assistant: {
          conversations: a.conversations,
          resolved_without_ticket: a.resolved,
          escalated: a.escalated,
          deflection_rate: finished > 0 ? round((100 * a.resolved) / finished) : null,
          escalation_reasons: escalations.rows,
          top_articles: topArticles.rows,
          failed_articles: failedArticles.rows,
        },
      };
    },

    // Exportación a Excel del rango (AC-007.20). Sin datos del solicitante, notas internas ni
    // descripciones: solo lo que el panel ya muestra, más el detalle por ticket.
    async exportWorkbook(range: Range, group: MetricGroup = "day"): Promise<Uint8Array> {
      const m = await this.metrics(range, group);
      const { rows: tickets } = await sql<{
        number: number;
        title: string;
        status: keyof typeof statusLabel;
        category: string;
        priority: string;
        assignee: string | null;
        created_at: Date;
        first_response_at: Date | null;
        closed_at: Date | null;
        closure_reason: keyof typeof closureReasonLabel | null;
        reopened_count: number;
        source: string;
      }>`
        SELECT t.number, t.title, t.status, c.name AS category, p.name AS priority, a.name AS assignee,
               t.created_at, t.first_response_at, t.closed_at, t.closure_reason, t.reopened_count, t.source
        FROM helpdesk.tickets t
        JOIN helpdesk.categories c ON c.code = t.category_code
        JOIN helpdesk.priorities p ON p.code = t.priority_code
        LEFT JOIN reto.agents a ON a.id = t.assignee_id
        WHERE t.created_at >= ${range.from}::date AND t.created_at < ${range.to}::date
        ORDER BY t.created_at
        LIMIT ${EXPORT_MAX_TICKETS + 1}
      `.execute(db);
      const truncated = tickets.length > EXPORT_MAX_TICKETS;
      const seconds = (from: Date, to: Date | null) => (to ? (new Date(to).getTime() - new Date(from).getTime()) / 1000 : null);

      const summary: Sheet = {
        name: "Resumen",
        columns: [{ header: "Indicador", width: 38 }, { header: "Valor", width: 22 }],
        rows: [
          ["Desde (incluido)", m.range.from],
          ["Hasta (sin incluir)", m.range.to],
          ["Generado (UTC)", new Date()],
          ["Tickets creados", m.total],
          ["Abiertos", m.by_status.open],
          ["En revisión", m.by_status.in_review],
          ["Cerrados", m.by_status.closed],
          ["Sin atender", m.unattended],
          ["Reabiertos", m.reopened],
          ["Tasa de reapertura (%)", m.reopen_rate],
          ["Primera respuesta · mediana (min)", minutes(m.first_response.p50)],
          ["Primera respuesta · p90 (min)", minutes(m.first_response.p90)],
          ["Resolución · mediana (h)", hours(m.resolution.p50)],
          ["Resolución · p90 (h)", hours(m.resolution.p90)],
          ["Conversaciones con el asistente", m.assistant.conversations],
          ["Resueltas sin ticket (%)", m.assistant.deflection_rate],
          ["Costo de IA · chat (US$)", m.ai.assistant_cost_usd],
          ["Costo de IA · copiloto (US$)", m.ai.copilot_cost_usd],
          ["Nota", "Tickets creados en el rango, tiempos en calendario y en UTC. Fórmulas en /admin/metricas → Fórmulas."],
          ...(truncated ? [["Aviso", `La hoja Tickets muestra los primeros ${EXPORT_MAX_TICKETS}. Elige un rango más corto para ver el resto.`] as const] : []),
        ].map((row) => [...row]),
      };
      const evolution: Sheet = {
        name: "Evolución",
        columns: [
          { header: "Periodo (inicio)", width: 16 },
          { header: "Creados" },
          { header: "Cerrados" },
          { header: "Reaperturas" },
          { header: "Primera respuesta · mediana (min)", width: 30 },
          { header: "Resolución · mediana (h)", width: 24 },
          { header: "Conversaciones" },
          { header: "Resueltas sin ticket", width: 20 },
          { header: "Escaladas" },
          { header: "Costo de IA (US$)", width: 18 },
        ],
        rows: m.series.points.map((p) => [
          p.bucket,
          p.created,
          p.closed,
          p.reopened,
          minutes(p.first_response_p50),
          hours(p.resolution_p50),
          p.conversations,
          p.resolved_without_ticket,
          p.escalated,
          p.ai_cost_usd,
        ]),
      };
      const byPriority: Sheet = {
        name: "Por prioridad",
        columns: [
          { header: "Prioridad" },
          { header: "Tickets" },
          { header: "Objetivo primera respuesta (min)", width: 30 },
          { header: "Cumplimiento primera respuesta (%)", width: 32 },
          { header: "Objetivo resolución (min)", width: 26 },
          { header: "Cumplimiento resolución (%)", width: 28 },
        ],
        rows: m.by_priority.map((p) => [p.name, p.count, p.first_response_target_minutes, p.first_response_compliance, p.resolution_target_minutes, p.resolution_compliance]),
      };
      const byCategory: Sheet = {
        name: "Por categoría",
        columns: [{ header: "Categoría", width: 30 }, { header: "Tickets" }],
        rows: m.by_category.map((c) => [c.name, c.count]),
      };
      const detail: Sheet = {
        name: "Tickets",
        columns: [
          { header: "Número", width: 12 },
          { header: "Título", width: 48 },
          { header: "Estado", width: 12 },
          { header: "Categoría", width: 26 },
          { header: "Prioridad", width: 12 },
          { header: "Responsable", width: 26 },
          { header: "Creado (UTC)", width: 18 },
          { header: "Primera respuesta (min)", width: 22 },
          { header: "Cerrado (UTC)", width: 18 },
          { header: "Motivo de cierre", width: 18 },
          { header: "Resolución (h)", width: 14 },
          { header: "Reaperturas", width: 12 },
          { header: "Origen", width: 18 },
        ],
        rows: tickets.slice(0, EXPORT_MAX_TICKETS).map((t) => [
          displayNumber(t.number),
          t.title,
          statusLabel[t.status],
          t.category,
          t.priority,
          t.assignee,
          new Date(t.created_at),
          minutes(seconds(t.created_at, t.first_response_at)),
          t.closed_at ? new Date(t.closed_at) : null,
          t.closure_reason ? closureReasonLabel[t.closure_reason] : null,
          t.status === "closed" && t.closure_reason === "resolved" ? hours(seconds(t.created_at, t.closed_at)) : null,
          t.reopened_count,
          SOURCE_LABEL[t.source] ?? t.source,
        ]),
      };
      return buildXlsx([summary, evolution, byPriority, byCategory, detail]);
    },

    // Estado operativo en vivo (no depende del rango). Listas cortas (5) para actuar ya.
    async operations(): Promise<Operations> {
      const LIMIT = 5;
      const list = async (where: ReturnType<typeof sql>, since: ReturnType<typeof sql>): Promise<{ count: number; items: AttentionItem[] }> => {
        const { rows } = await sql<{ id: string; number: number; title: string; priority: string; priority_code: string; since: Date; assignee: string | null; total: number }>`
          SELECT t.id, t.number, t.title, p.name AS priority, p.code AS priority_code, ${since} AS since, a.name AS assignee, count(*) OVER ()::int AS total
          FROM helpdesk.tickets t
          JOIN helpdesk.priorities p ON p.code = t.priority_code
          LEFT JOIN reto.agents a ON a.id = t.assignee_id
          WHERE ${where}
          ORDER BY ${since} ASC
          LIMIT ${LIMIT}
        `.execute(db);
        return {
          count: rows[0]?.total ?? 0,
          items: rows.map((row) => ({
            id: row.id,
            display_number: displayNumber(row.number),
            title: row.title,
            priority: row.priority,
            priority_code: row.priority_code,
            since: new Date(row.since).toISOString(),
            assignee: row.assignee,
          })),
        };
      };

      const [unattended, waitingTeam, waitingRequester, aging, workload, unassigned, health] = await Promise.all([
        list(sql`t.status = 'open' AND t.first_response_at IS NULL`, sql`t.created_at`),
        // El solicitante escribió último y el equipo todavía no contestó.
        list(
          sql`t.status <> 'closed' AND t.last_requester_reply_at IS NOT NULL AND (t.last_team_reply_at IS NULL OR t.last_requester_reply_at > t.last_team_reply_at)`,
          sql`t.last_requester_reply_at`,
        ),
        // Hay una solicitud de información más nueva que la última respuesta del solicitante.
        list(
          sql`t.status <> 'closed' AND EXISTS (SELECT 1 FROM helpdesk.ticket_comments c WHERE c.ticket_id = t.id AND c.requests_info AND c.visibility = 'public' AND c.created_at > coalesce(t.last_requester_reply_at, '-infinity'::timestamptz))`,
          sql`(SELECT max(c.created_at) FROM helpdesk.ticket_comments c WHERE c.ticket_id = t.id AND c.requests_info)`,
        ),
        sql<Operations["aging"]>`
          SELECT count(*) FILTER (WHERE now() - created_at < interval '24 hours')::int AS under_24h,
                 count(*) FILTER (WHERE now() - created_at >= interval '24 hours' AND now() - created_at < interval '3 days')::int AS d1_3,
                 count(*) FILTER (WHERE now() - created_at >= interval '3 days' AND now() - created_at < interval '7 days')::int AS d3_7,
                 count(*) FILTER (WHERE now() - created_at >= interval '7 days')::int AS over_7d
          FROM helpdesk.tickets WHERE status <> 'closed'
        `.execute(db),
        sql<Operations["workload"][number]>`
          SELECT a.id, a.name,
                 count(t.id) FILTER (WHERE t.status = 'open')::int AS open,
                 count(t.id) FILTER (WHERE t.status = 'in_review')::int AS in_review
          FROM reto.agents a
          LEFT JOIN helpdesk.tickets t ON t.assignee_id = a.id AND t.status <> 'closed'
          WHERE a.role = 'admin'
          GROUP BY a.id, a.name
          ORDER BY count(t.id) DESC, a.name
        `.execute(db),
        sql<{ n: number }>`SELECT count(*)::int AS n FROM helpdesk.tickets WHERE status <> 'closed' AND assignee_id IS NULL`.execute(db),
        sql<Operations["health"]>`
          SELECT
            (SELECT count(*)::int FROM helpdesk.notification_deliveries WHERE status = 'failed' AND updated_at > now() - interval '7 days') AS failed_deliveries_7d,
            (SELECT count(*)::int FROM helpdesk.notification_deliveries WHERE status = 'pending') AS pending_deliveries,
            (SELECT count(*)::int FROM helpdesk.incidents WHERE status <> 'resolved') AS active_incidents,
            (SELECT count(*)::int FROM helpdesk.tickets t JOIN helpdesk.incidents i ON i.id = t.incident_id WHERE i.status <> 'resolved' AND t.status <> 'closed') AS tickets_in_active_incidents
        `.execute(db),
      ]);

      return {
        unattended,
        waiting_team: waitingTeam,
        waiting_requester: waitingRequester,
        aging: aging.rows[0]!,
        workload: workload.rows,
        unassigned: unassigned.rows[0]?.n ?? 0,
        health: health.rows[0]!,
      };
    },
  };
}

export type MetricsService = ReturnType<typeof createMetricsService>;
