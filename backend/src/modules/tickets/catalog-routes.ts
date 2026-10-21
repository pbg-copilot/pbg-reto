import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { adminSchema, apiErrorSchema, categorySchema, isAdmin, prioritySchema } from "@reto/shared";

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

  app.get(
    "/support/admins",
    {
      preValidation: app.requireAdmin,
      schema: {
        tags: ["support"],
        security,
        summary: "Administradores asignables (solo admin)",
        response: { 200: z.array(adminSchema), 401: apiErrorSchema, 403: apiErrorSchema },
      },
    },
    async () =>
      app.db.selectFrom("reto.agents").select(["id", "name", "email"]).where("role", "=", "admin").orderBy("name").execute(),
  );
};

export default catalogRoutes;
