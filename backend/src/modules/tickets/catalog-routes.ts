import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { adminSchema, apiErrorSchema, categorySchema, isAdmin, prioritySchema, updatePriorityBodySchema } from "@reto/shared";
import { notFound } from "../../lib/errors.js";
import { mutationRateLimit } from "../../lib/rate-limit.js";

const security: Record<string, string[]>[] = [{ bearer: [] }, { cookie: [] }];

// Catálogos de apoyo para formularios y filtros.
const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/support/categories",
    {
      preValidation: app.requireAuth,
      schema: {
        tags: ["support"],
        security,
        summary: "Categorías activas",
        response: { 200: z.array(categorySchema), 401: apiErrorSchema },
      },
    },
    async () =>
      app.db
        .selectFrom("helpdesk.categories")
        .select(["code", "name"])
        .where("is_active", "=", true)
        .orderBy("sort")
        .execute(),
  );

  app.get(
    "/support/priorities",
    {
      preValidation: app.requireAuth,
      schema: {
        tags: ["support"],
        security,
        summary: "Prioridades activas",
        description: "El solicitante no recibe los objetivos de atención (no se le prometen plazos).",
        response: { 200: z.array(prioritySchema), 401: apiErrorSchema },
      },
    },
    async (request) => {
      const rows = await app.db
        .selectFrom("helpdesk.priorities")
        .select(["code", "name", "rank", "first_response_target_minutes", "resolution_target_minutes"])
        .where("is_active", "=", true)
        .orderBy("rank")
        .execute();
      if (isAdmin(request.actor)) return rows;
      return rows.map(({ code, name, rank }) => ({ code, name, rank }));
    },
  );

  // Objetivos de atención configurables (AC-007.3). Cambiarlos no reescribe tickets anteriores:
  // las métricas siempre comparan contra el objetivo vigente.
  app.patch(
    "/support/priorities/:code",
    {
      preValidation: app.requireAdmin,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags: ["support"],
        security,
        summary: "Configurar una prioridad (solo admin)",
        description: "Objetivos en minutos; null quita el objetivo. El solicitante nunca ve objetivos ni plazos.",
        params: z.object({ code: z.string().min(1).max(20) }),
        body: updatePriorityBodySchema,
        response: { 200: prioritySchema, 400: apiErrorSchema, 401: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request) => {
      const row = await app.db
        .updateTable("helpdesk.priorities")
        .set(request.body)
        .where("code", "=", request.params.code)
        .returning(["code", "name", "rank", "first_response_target_minutes", "resolution_target_minutes"])
        .executeTakeFirst();
      if (!row) throw notFound("No existe esa prioridad.");
      return row;
    },
  );

  app.get(
    "/support/admins",
    {
      preValidation: app.requireAdmin,
      schema: {
        tags: ["support"],
        security,
        summary: "Administradores asignables con su carga (solo admin)",
        response: { 200: z.array(adminSchema), 401: apiErrorSchema, 403: apiErrorSchema },
      },
    },
    async () => {
      const rows = await app.db
        .selectFrom("reto.agents as a")
        .leftJoin("helpdesk.tickets as t", (join) => join.onRef("t.assignee_id", "=", "a.id").on("t.status", "!=", "closed"))
        .select((eb) => ["a.id", "a.name", "a.email", eb.fn.count<string>("t.id").as("open_tickets")])
        .where("a.role", "=", "admin")
        .groupBy(["a.id", "a.name", "a.email"])
        .orderBy("a.name")
        .execute();
      return rows.map((row) => ({ ...row, open_tickets: Number(row.open_tickets) }));
    },
  );
};

export default catalogRoutes;
