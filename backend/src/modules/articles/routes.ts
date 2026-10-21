import { z } from "zod";
import { sql } from "kysely";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  apiErrorSchema,
  articleListSchema,
  articleManageSchema,
  articleReaderSchema,
  createArticleBodySchema,
  incidentBodySchema,
  incidentListSchema,
  incidentSchema,
  listIncidentsQuerySchema,
  isAdmin,
  listArticlesQuerySchema,
  newVersionBodySchema,
  publishBodySchema,
  updateIncidentBodySchema,
  type Incident,
} from "@reto/shared";
import { AppError, notFound } from "../../lib/errors.js";
import { mutationRateLimit } from "../../lib/rate-limit.js";
import type { ArticleService } from "./service.js";

const security: Record<string, string[]>[] = [{ bearer: [] }, { cookie: [] }];
const errors = { 400: apiErrorSchema, 401: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema };
const fromTicketSchema = articleManageSchema.extend({ reused: z.boolean().describe("true si ya existía un artículo de este ticket") });
const idParams = z.object({ id: z.uuid() });

const articleRoutes: FastifyPluginAsyncZod<{ service: ArticleService }> = async (app, { service }) => {
  const tags = ["catálogo"];

  app.get(
    "/support/articles",
    {
      preValidation: app.requireAuth,
      schema: {
        tags,
        security,
        summary: "Buscar artículos",
        description: "Solicitante: solo publicados y vigentes. Admin: todos los estados (última versión). Búsqueda en español sin acentos.",
        querystring: listArticlesQuerySchema,
        response: { 200: articleListSchema, ...errors },
      },
    },
    async (request) => service.list(request.actor!, request.query),
  );

  app.get(
    "/support/articles/:idOrSlug",
    {
      preValidation: app.requireAuth,
      schema: {
        tags,
        security,
        summary: "Leer un artículo",
        description: "Sin ?v=, la versión publicada vigente. El solicitante puede leer versiones publicadas anteriormente (enlaces del chat).",
        params: z.object({ idOrSlug: z.string().min(1).max(120) }),
        querystring: z.object({ v: z.coerce.number().int().min(1).optional() }),
        response: { 200: articleReaderSchema, ...errors },
      },
    },
    async (request) => service.read(request.actor!, request.params.idOrSlug, request.query.v),
  );

  app.get(
    "/support/articles/:id/manage",
    {
      preValidation: app.requireAdmin,
      schema: { tags, security, summary: "Gestión de un artículo (admin)", params: idParams, response: { 200: articleManageSchema, ...errors } },
    },
    async (request) => service.manage(request.actor!, request.params.id),
  );

  app.post(
    "/support/articles",
    {
      preValidation: app.requireAdmin,
      config: { rateLimit: mutationRateLimit },
      schema: { tags, security, summary: "Crear artículo (borrador)", body: createArticleBodySchema, response: { 201: articleManageSchema, ...errors } },
    },
    async (request, reply) => reply.code(201).send(await service.create(request.actor!, request.body)),
  );

  app.post(
    "/support/articles/:id/versions",
    {
      preValidation: app.requireAdmin,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Nueva versión (las versiones son inmutables)",
        description: "base_version desactualizada → 409 version_conflict.",
        params: idParams,
        body: newVersionBodySchema,
        response: { 201: articleManageSchema, ...errors, 409: apiErrorSchema },
      },
    },
    async (request, reply) => reply.code(201).send(await service.newVersion(request.actor!, request.params.id, request.body)),
  );

  app.post(
    "/support/articles/:id/publish",
    {
      preValidation: app.requireAdmin,
      config: { rateLimit: mutationRateLimit },
      schema: { tags, security, summary: "Publicar una versión", params: idParams, body: publishBodySchema, response: { 200: articleManageSchema, ...errors } },
    },
    async (request) => service.publish(request.actor!, request.params.id, request.body.version_id),
  );

  app.post(
    "/support/articles/:id/archive",
    {
      preValidation: app.requireAdmin,
      config: { rateLimit: mutationRateLimit },
      schema: { tags, security, summary: "Archivar artículo", params: idParams, response: { 200: articleManageSchema, ...errors } },
    },
    async (request) => service.archive(request.actor!, request.params.id),
  );

  app.post(
    "/support/articles/from-ticket/:ticketId",
    {
      preValidation: app.requireAdmin,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Borrador desde un ticket resuelto",
        description:
          "Idempotente: un solo artículo (no archivado) por ticket. Si ya existe, responde 200 con `reused: true` y el mismo artículo; si no, 201. No copia comentarios, notas internas, adjuntos ni datos personales.",
        params: z.object({ ticketId: z.uuid() }),
        response: { 200: fromTicketSchema, 201: fromTicketSchema, ...errors, 422: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const article = await service.fromTicket(request.actor!, request.params.ticketId);
      return reply.code(article.reused ? 200 : 201).send(article);
    },
  );

  app.delete(
    "/support/articles/:id",
    {
      preValidation: app.requireAdmin,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Descartar un borrador que nunca se publicó",
        description: "Lo que alguna vez se publicó no se borra (409): se archiva para conservar la trazabilidad.",
        params: idParams,
        response: { 204: z.undefined(), ...errors, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      await service.discard(request.actor!, request.params.id);
      return reply.code(204).send();
    },
  );

  // ---------- Incidentes ----------

  const incidentTags = ["incidentes"];
  async function countIncidents(active: boolean) {
    let query = app.db.selectFrom("helpdesk.incidents").select((eb) => eb.fn.countAll<string>().as("n"));
    if (active) query = query.where("status", "<>", "resolved");
    return Number((await query.executeTakeFirstOrThrow()).n);
  }

  async function loadIncidents(where: { id?: string; active?: boolean; limit?: number; offset?: number }, admin: boolean): Promise<Incident[]> {
    let query = app.db
      .selectFrom("helpdesk.incidents as i")
      .leftJoin("helpdesk.articles as a", "a.id", "i.article_id")
      .leftJoin("helpdesk.article_versions as v", "v.id", "a.published_version_id")
      .select([
        "i.id",
        "i.title",
        "i.public_summary",
        "i.status",
        "i.category_code",
        "i.started_at",
        "i.resolved_at",
        "a.slug as article_slug",
        "v.title as article_title",
        sql<number>`(SELECT count(*)::int FROM helpdesk.tickets t WHERE t.incident_id = i.id)`.as("linked_tickets"),
      ])
      .orderBy("i.started_at", "desc");
    if (where.id) query = query.where("i.id", "=", where.id);
    if (where.active) query = query.where("i.status", "<>", "resolved");
    if (where.limit) query = query.orderBy("i.id").limit(where.limit).offset(where.offset ?? 0);
    const rows = await query.execute();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      public_summary: row.public_summary,
      status: row.status,
      category: row.category_code,
      article: row.article_slug && row.article_title ? { slug: row.article_slug, title: row.article_title } : null,
      started_at: new Date(row.started_at).toISOString(),
      resolved_at: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      // El conteo de tickets afectados es información del equipo.
      ...(admin ? { linked_tickets: row.linked_tickets } : {}),
    }));
  }

  app.get(
    "/support/incidents",
    {
      preValidation: app.requireAuth,
      schema: {
        tags: incidentTags,
        security,
        summary: "Incidentes conocidos",
        description: "Vista pública: nunca incluye tickets ni datos de solicitantes. Paginada, de la más reciente a la más antigua.",
        querystring: listIncidentsQuerySchema,
        response: { 200: incidentListSchema, ...errors },
      },
    },
    async (request) => {
      const { page, page_size } = request.query;
      const active = request.query.active === "true";
      const [items, total] = await Promise.all([
        loadIncidents({ active, limit: page_size, offset: (page - 1) * page_size }, isAdmin(request.actor)),
        countIncidents(active),
      ]);
      return { items, page, page_size, total };
    },
  );

  app.post(
    "/support/incidents",
    {
      preValidation: app.requireAdmin,
      config: { rateLimit: mutationRateLimit },
      schema: { tags: incidentTags, security, summary: "Registrar incidente", body: incidentBodySchema, response: { 201: incidentSchema, ...errors } },
    },
    async (request, reply) => {
      const body = incidentBodySchema.parse(request.body);
      const created = await app.db
        .insertInto("helpdesk.incidents")
        .values({
          title: body.title,
          public_summary: body.public_summary,
          status: body.status,
          category_code: body.category ?? null,
          article_id: body.article_id ?? null,
          resolved_at: body.status === "resolved" ? sql`now()` : null,
          created_by: request.actor!.id,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const [incident] = await loadIncidents({ id: created.id }, true);
      return reply.code(201).send(incident!);
    },
  );

  app.patch(
    "/support/incidents/:id",
    {
      preValidation: app.requireAdmin,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags: incidentTags,
        security,
        summary: "Actualizar incidente",
        params: idParams,
        body: updateIncidentBodySchema,
        response: { 200: incidentSchema, ...errors },
      },
    },
    async (request) => {
      const body = request.body;
      if (Object.keys(body).length === 0) throw new AppError(400, "invalid_request", "Indica al menos un cambio.");
      const updated = await app.db
        .updateTable("helpdesk.incidents")
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.public_summary !== undefined ? { public_summary: body.public_summary } : {}),
          ...(body.category !== undefined ? { category_code: body.category } : {}),
          ...(body.article_id !== undefined ? { article_id: body.article_id } : {}),
          ...(body.status !== undefined
            ? { status: body.status, resolved_at: body.status === "resolved" ? sql`coalesce(resolved_at, now())` : null }
            : {}),
          updated_at: sql`now()`,
        })
        .where("id", "=", request.params.id)
        .returning("id")
        .executeTakeFirst();
      if (!updated) throw notFound("No encontramos este incidente.");
      const [incident] = await loadIncidents({ id: updated.id }, true);
      return incident!;
    },
  );
};

export default articleRoutes;
