import { sql, type Transaction } from "kysely";
import {
  articleContentSchema,
  displayNumber,
  isAdmin,
  type Agent,
  type ArticleList,
  type ArticleManage,
  type ArticleReader,
  type ArticleSummary,
  type ArticleVersion,
  type CreateArticleBody,
  type ListArticlesFilters,
  type NewVersionBody,
} from "@reto/shared";
import type { Database } from "../../db/kysely.js";
import type { ArticleRow, ArticleVersionRow, DB } from "../../db/types.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { searchCondition, searchRank } from "./search.js";
import { redactPersonalData, slugify } from "./text.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const articleNotFound = () => notFound("No encontramos este artículo o ya no está disponible.");
const iso = (value: Date | string) => new Date(value).toISOString();

export const articleUrl = (slug: string, version?: number) =>
  `/soporte/articulos/${slug}${version ? `?v=${version}` : ""}`;

type ListRow = ArticleRow & {
  title: string;
  symptoms: string;
  tags: string[];
  reviewed_at: string;
  latest_version: number;
  published_number: number | null;
};

function toSummary(row: ListRow): ArticleSummary {
  return {
    id: row.id,
    slug: row.slug,
    category: row.category_code,
    status: row.status,
    is_example: row.is_example,
    title: row.title,
    symptoms: row.symptoms,
    tags: row.tags,
    reviewed_at: row.reviewed_at,
    published_version: row.published_number,
    latest_version: row.latest_version,
    updated_at: iso(row.updated_at),
    url: articleUrl(row.slug),
  };
}

export function toVersion(row: ArticleVersionRow): ArticleVersion {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    symptoms: row.symptoms,
    applies_to: row.applies_to,
    diagnosis_steps: row.diagnosis_steps,
    solution: row.solution,
    escalation_conditions: row.escalation_conditions,
    tags: row.tags,
    reviewed_at: row.reviewed_at,
    valid_until: row.valid_until,
    published_at: row.published_at ? iso(row.published_at) : null,
    created_at: iso(row.created_at),
  };
}

// Artículos que puede usar el asistente: publicados y vigentes.
export const isUsableSql = sql<boolean>`(a.status = 'published' AND (v.valid_until IS NULL OR v.valid_until >= current_date))`;

export function createArticleService(db: Database) {
  async function findArticle(idOrSlug: string) {
    const query = db.selectFrom("helpdesk.articles").selectAll();
    return (UUID.test(idOrSlug) ? query.where("id", "=", idOrSlug) : query.where("slug", "=", idOrSlug)).executeTakeFirst();
  }

  async function uniqueSlug(trx: Transaction<DB>, title: string) {
    const base = slugify(title);
    const taken = await trx
      .selectFrom("helpdesk.articles")
      .select("slug")
      .where((eb) => eb.or([eb("slug", "=", base), eb("slug", "like", `${base}-%`)]))
      .execute();
    const used = new Set(taken.map((row) => row.slug));
    if (!used.has(base)) return base;
    let n = 2;
    while (used.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  async function insertVersion(
    trx: Transaction<DB>,
    articleId: string,
    version: number,
    body: CreateArticleBody | NewVersionBody,
    actorId: string | null,
  ) {
    // Solo los campos de contenido (sin is_example ni base_version) y con sus valores por defecto.
    const content = articleContentSchema.parse({
      title: body.title,
      category: body.category,
      symptoms: body.symptoms,
      applies_to: body.applies_to,
      diagnosis_steps: body.diagnosis_steps,
      solution: body.solution,
      escalation_conditions: body.escalation_conditions,
      tags: body.tags,
      reviewed_at: body.reviewed_at,
      valid_until: body.valid_until,
    });
    return trx
      .insertInto("helpdesk.article_versions")
      .values({
        article_id: articleId,
        version,
        title: content.title,
        symptoms: content.symptoms,
        applies_to: content.applies_to,
        diagnosis_steps: content.diagnosis_steps,
        solution: content.solution,
        escalation_conditions: content.escalation_conditions,
        tags: [...new Set(content.tags.map((tag) => tag.toLowerCase()))],
        reviewed_at: content.reviewed_at ?? sql<string>`current_date`,
        valid_until: content.valid_until ?? null,
        published_at: null,
        created_by: actorId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async function requireCategory(trx: Transaction<DB>, code: string) {
    const found = await trx.selectFrom("helpdesk.categories").select("code").where("code", "=", code).executeTakeFirst();
    if (!found)
      throw new AppError(400, "invalid_request", "La categoría no existe.", { fields: { category: "Categoría no válida" } });
  }

  async function insertArticle(trx: Transaction<DB>, actor: Agent, body: CreateArticleBody, sourceTicketId: string | null) {
    await requireCategory(trx, body.category);
    const article = await trx
      .insertInto("helpdesk.articles")
      .values({
        slug: await uniqueSlug(trx, body.title),
        category_code: body.category,
        is_example: body.is_example ?? false,
        published_version_id: null,
        source_ticket_id: sourceTicketId,
        created_by: actor.id,
        archived_at: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await insertVersion(trx, article.id, 1, body, actor.id);
    return article.id;
  }

  const service = {
    // El solicitante ve solo artículos publicados y vigentes; el admin, todos (última versión).
    async list(actor: Agent, filters: ListArticlesFilters): Promise<ArticleList> {
      const admin = isAdmin(actor);
      const versionJoin = admin
        ? sql`JOIN LATERAL (SELECT * FROM helpdesk.article_versions lv WHERE lv.article_id = a.id ORDER BY lv.version DESC LIMIT 1) v ON true`
        : sql`JOIN helpdesk.article_versions v ON v.id = a.published_version_id`;
      const conditions = [admin ? sql`true` : isUsableSql];
      if (admin && filters.status) conditions.push(sql`a.status = ${filters.status}`);
      if (filters.category) conditions.push(sql`a.category_code = ${filters.category}`);
      if (filters.tag) conditions.push(sql`${filters.tag.toLowerCase()} = ANY(v.tags)`);
      if (filters.q) conditions.push(searchCondition(filters.q));
      const where = sql.join(conditions, sql` AND `);
      const order = filters.q ? sql`${searchRank(filters.q)} DESC, a.updated_at DESC` : sql`a.updated_at DESC`;

      const { rows } = await sql<ListRow & { total: number }>`
        SELECT a.*, v.title, v.symptoms, v.tags, v.reviewed_at,
               (SELECT max(version) FROM helpdesk.article_versions x WHERE x.article_id = a.id) AS latest_version,
               (SELECT version FROM helpdesk.article_versions p WHERE p.id = a.published_version_id) AS published_number,
               count(*) OVER ()::int AS total
        FROM helpdesk.articles a ${versionJoin}
        WHERE ${where}
        ORDER BY ${order}
        LIMIT ${filters.page_size} OFFSET ${(filters.page - 1) * filters.page_size}
      `.execute(db);
      return {
        items: rows.map(toSummary),
        page: filters.page,
        page_size: filters.page_size,
        total: rows[0]?.total ?? 0,
      };
    },

    // Lectura de una versión. El solicitante solo lee versiones que se publicaron alguna vez;
    // sin ?v=, la publicada vigente.
    async read(actor: Agent, idOrSlug: string, versionNumber?: number): Promise<ArticleReader> {
      const article = await findArticle(idOrSlug);
      if (!article) throw articleNotFound();
      const admin = isAdmin(actor);
      let query = db.selectFrom("helpdesk.article_versions").selectAll().where("article_id", "=", article.id);
      if (versionNumber !== undefined) query = query.where("version", "=", versionNumber);
      else if (article.published_version_id) query = query.where("id", "=", article.published_version_id);
      else if (admin) query = query.orderBy("version", "desc").limit(1);
      else throw articleNotFound();
      const version = await query.executeTakeFirst();
      if (!version) throw articleNotFound();
      const current = article.status === "published" && version.id === article.published_version_id;
      if (!admin) {
        const everPublished = version.published_at !== null;
        if (!everPublished || (versionNumber === undefined && !current)) throw articleNotFound();
      }
      return {
        id: article.id,
        slug: article.slug,
        category: article.category_code,
        status: article.status,
        is_example: article.is_example,
        is_current: current,
        version: toVersion(version),
      };
    },

    async manage(actor: Agent, id: string): Promise<ArticleManage> {
      if (!isAdmin(actor)) throw forbidden();
      const article = await findArticle(id);
      if (!article) throw articleNotFound();
      const versions = await db
        .selectFrom("helpdesk.article_versions as v")
        .leftJoin("reto.agents as u", "u.id", "v.created_by")
        .selectAll("v")
        .select("u.name as created_by_name")
        .where("v.article_id", "=", article.id)
        .orderBy("v.version", "desc")
        .execute();
      const latest = versions[0]!;
      const published = versions.find((v) => v.id === article.published_version_id) ?? null;
      const source = article.source_ticket_id
        ? await db.selectFrom("helpdesk.tickets").select(["id", "number"]).where("id", "=", article.source_ticket_id).executeTakeFirst()
        : undefined;
      return {
        ...toSummary({
          ...article,
          title: latest.title,
          symptoms: latest.symptoms,
          tags: latest.tags,
          reviewed_at: latest.reviewed_at,
          latest_version: latest.version,
          published_number: published?.version ?? null,
        }),
        versions: versions.map((v) => ({ ...toVersion(v), created_by: v.created_by_name ?? null })),
        source_ticket: source ? { id: source.id, display_number: displayNumber(source.number) } : null,
      };
    },

    async create(actor: Agent, body: CreateArticleBody, sourceTicketId: string | null = null): Promise<ArticleManage> {
      if (!isAdmin(actor)) throw forbidden();
      const id = await db.transaction().execute((trx) => insertArticle(trx, actor, body, sourceTicketId));
      return service.manage(actor, id);
    },

    // Descarta un borrador que nunca se publicó (por ejemplo, uno creado por error). Lo que
    // alguna vez se publicó no se borra: se archiva, para conservar la trazabilidad.
    async discard(actor: Agent, id: string) {
      if (!isAdmin(actor)) throw forbidden();
      const deleted = await db
        .deleteFrom("helpdesk.articles")
        .where("id", "=", id)
        .where("status", "=", "draft")
        .where("published_version_id", "is", null)
        .where(({ not, exists, selectFrom }) =>
          not(exists(selectFrom("helpdesk.article_versions").select("id").whereRef("article_id", "=", "helpdesk.articles.id").where("published_at", "is not", null))),
        )
        .executeTakeFirst();
      if (Number(deleted.numDeletedRows) > 0) return;
      if (await findArticle(id)) throw new AppError(409, "invalid_transition", "Solo se descarta un borrador que nunca se publicó. Para retirarlo del chat, archívalo.");
      throw articleNotFound();
    },

    // Las versiones son inmutables: editar crea la siguiente. La publicada no cambia hasta publicar.
    async newVersion(actor: Agent, id: string, body: NewVersionBody): Promise<ArticleManage> {
      if (!isAdmin(actor)) throw forbidden();
      await db.transaction().execute(async (trx) => {
        const article = await trx.selectFrom("helpdesk.articles").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
        if (!article) throw articleNotFound();
        const latest = await trx
          .selectFrom("helpdesk.article_versions")
          .select(({ fn }) => fn.max<number>("version").as("version"))
          .where("article_id", "=", id)
          .executeTakeFirstOrThrow();
        if (latest.version !== body.base_version)
          throw new AppError(409, "version_conflict", "Otro administrador guardó una versión más nueva de este artículo.", {
            latest_version: latest.version,
          });
        await requireCategory(trx, body.category);
        await insertVersion(trx, id, latest.version + 1, body, actor.id);
        await trx
          .updateTable("helpdesk.articles")
          .set({ category_code: body.category, updated_at: sql`now()` })
          .where("id", "=", id)
          .execute();
      });
      return service.manage(actor, id);
    },

    async publish(actor: Agent, id: string, versionId: string): Promise<ArticleManage> {
      if (!isAdmin(actor)) throw forbidden();
      await db.transaction().execute(async (trx) => {
        const version = await trx
          .updateTable("helpdesk.article_versions")
          .set({ published_at: sql`coalesce(published_at, now())` })
          .where("id", "=", versionId)
          .where("article_id", "=", id)
          .returning("id")
          .executeTakeFirst();
        if (!version) throw articleNotFound();
        await trx
          .updateTable("helpdesk.articles")
          .set({ status: "published", published_version_id: versionId, archived_at: null, updated_at: sql`now()` })
          .where("id", "=", id)
          .execute();
      });
      return service.manage(actor, id);
    },

    // Archivar es idempotente. El chat deja de usarlo; las conversaciones viejas siguen enlazando la versión.
    async archive(actor: Agent, id: string): Promise<ArticleManage> {
      if (!isAdmin(actor)) throw forbidden();
      const updated = await db
        .updateTable("helpdesk.articles")
        .set({ status: "archived", archived_at: sql`coalesce(archived_at, now())`, updated_at: sql`now()` })
        .where("id", "=", id)
        .returning("id")
        .executeTakeFirst();
      if (!updated) throw articleNotFound();
      return service.manage(actor, id);
    },

    // Borrador a partir de un ticket resuelto. Solo campos de una lista blanca y con datos
    // personales enmascarados: nunca comentarios, notas internas ni adjuntos (§03).
    async fromTicket(actor: Agent, ticketId: string): Promise<ArticleManage & { reused: boolean }> {
      if (!isAdmin(actor)) throw forbidden();
      const ticket = await db
        .selectFrom("helpdesk.tickets as t")
        .innerJoin("reto.agents as r", "r.id", "t.requester_id")
        .select([
          "t.id",
          "t.title",
          "t.category_code",
          "t.status",
          "t.closure_reason",
          "t.resolution_summary",
          "t.ai_summary",
          "t.attempted_steps",
          "t.original_description",
          "t.tags",
          "r.name as requester_name",
          "r.email as requester_email",
        ])
        .where("t.id", "=", ticketId)
        .executeTakeFirst();
      if (!ticket) throw notFound("No encontramos este ticket.");
      if (ticket.status !== "closed" || ticket.closure_reason !== "resolved" || !ticket.resolution_summary)
        throw new AppError(422, "invalid_transition", "Solo se puede crear un artículo desde un ticket cerrado como resuelto.");

      const clean = (text: string) => redactPersonalData(text, [ticket.requester_name, ticket.requester_email]);
      const summary = (ticket.ai_summary ?? {}) as Record<string, unknown>;
      const symptom = typeof summary.reported_symptom === "string" ? summary.reported_symptom : ticket.original_description.slice(0, 600);
      const steps = (ticket.attempted_steps as { step?: string; result?: string }[])
        .filter((step) => step.step)
        .map((step, index) => `${index + 1}. ${step.step}${step.result ? ` → ${step.result}` : ""}`);
      // Un solo artículo por ticket: si ya hay uno sin archivar, se vuelve a él (idempotente).
      // El candado evita dos borradores por un doble clic simultáneo.
      const draft: CreateArticleBody = {
          title: clean(ticket.title),
          category: ticket.category_code,
          symptoms: clean(symptom),
          applies_to: "",
          diagnosis_steps: clean(steps.join("\n") || "1. Confirma que el problema coincide con los síntomas descritos."),
          solution: clean(ticket.resolution_summary),
          escalation_conditions: "Si después de seguir la solución el problema continúa, crea un ticket con los pasos que ya probaste.",
          tags: ticket.tags,
          is_example: false,
        };
      const { id, reused } = await db.transaction().execute(async (trx) => {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${`article-from-ticket:${ticket.id}`}))`.execute(trx);
        const existing = await trx
          .selectFrom("helpdesk.articles")
          .select("id")
          .where("source_ticket_id", "=", ticket.id)
          .where("status", "<>", "archived")
          .orderBy("updated_at", "desc")
          .executeTakeFirst();
        if (existing) return { id: existing.id, reused: true };
        return { id: await insertArticle(trx, actor, draft, ticket.id), reused: false };
      });
      return { ...(await service.manage(actor, id)), reused };
    },

  };
  return service;
}

export type ArticleService = ReturnType<typeof createArticleService>;
