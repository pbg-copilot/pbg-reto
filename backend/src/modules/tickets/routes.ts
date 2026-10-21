import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  apiErrorSchema,
  assignBodySchema,
  changeStatusBodySchema,
  commentBodySchema,
  commentSchema,
  createTicketBodySchema,
  editCommentBodySchema,
  listTicketsQuerySchema,
  reopenBodySchema,
  ticketDetailSchema,
  ticketListSchema,
  updateTicketBodySchema,
} from "@reto/shared";
import { mutationRateLimit } from "../../lib/rate-limit.js";
import type { TicketService } from "./service.js";

const idParams = z.object({ id: z.uuid() });
const commentParams = idParams.extend({ commentId: z.uuid() });
const security: Record<string, string[]>[] = [{ bearer: [] }, { cookie: [] }];
const errors = { 400: apiErrorSchema, 401: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema };
// looseObject: conserva el resto de los headers (authorization, cookie…).
const idempotencyHeader = z.looseObject({
  "idempotency-key": z.string().min(8).max(128).describe("UUID por intención del usuario; reutilizarlo en los reintentos"),
});

const ticketRoutes: FastifyPluginAsyncZod<{ service: TicketService }> = async (app, { service }) => {
  // Autenticación antes de validar el body: sin permiso, 401/403 y no errores de esquema.
  const authed = { preValidation: app.requireAuth };
  const idempotent = { preValidation: app.requireAuth, preHandler: app.idempotent };
  const tags = ["tickets"];

  app.post(
    "/tickets",
    {
      ...idempotent,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Crear ticket (formulario manual)",
        description: "El solicitante sale de la sesión. Estado inicial: Abierto. Funciona sin IA.",
        headers: idempotencyHeader,
        body: createTicketBodySchema,
        response: { 201: ticketDetailSchema, ...errors, 422: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const ticket = await service.create(request.actor!, request.body, { source: "manual_form" });
      return reply.code(201).send(ticket);
    },
  );

  app.get(
    "/tickets",
    {
      ...authed,
      schema: {
        tags,
        security,
        summary: "Listar tickets",
        description:
          "El solicitante ve solo los suyos (compartir agencia no da acceso). El admin ve todos. Incluye conteos por estado para las pestañas.",
        querystring: listTicketsQuerySchema,
        response: { 200: ticketListSchema, ...errors },
      },
    },
    async (request) => service.list(request.actor!, request.query),
  );

  app.get(
    "/tickets/:id",
    {
      ...authed,
      schema: {
        tags,
        security,
        summary: "Detalle del ticket",
        description: "Un ticket ajeno responde 404. Marca el ticket como leído. El solicitante no recibe notas internas.",
        params: idParams,
        response: { 200: ticketDetailSchema, ...errors },
      },
    },
    async (request) => service.detail(request.actor!, request.params.id, { markAsRead: true }),
  );

  app.post(
    "/tickets/:id/comments",
    {
      ...idempotent,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Comentar",
        description: "Público (solicitante y equipo) o nota interna (solo equipo). Un ticket cerrado acepta solo notas internas.",
        headers: idempotencyHeader,
        params: idParams,
        body: commentBodySchema,
        response: { 201: commentSchema, ...errors, 409: apiErrorSchema },
      },
    },
    async (request, reply) => reply.code(201).send(await service.comment(request.actor!, request.params.id, request.body)),
  );

  app.patch(
    "/tickets/:id/comments/:commentId",
    {
      ...authed,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Corregir un comentario propio",
        description: "Conserva el texto anterior en el historial de revisiones.",
        params: commentParams,
        body: editCommentBodySchema,
        response: { 200: commentSchema, ...errors },
      },
    },
    async (request) =>
      service.editComment(request.actor!, request.params.id, request.params.commentId, request.body.body),
  );

  app.patch(
    "/tickets/:id/status",
    {
      ...authed,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Cambiar estado (solo admin)",
        description:
          "Abierto → En revisión → Cerrado, o Abierto → Cerrado con motivo. Mismo estado: 200 sin evento. Versión desactualizada: 409 con el ticket actual.",
        params: idParams,
        body: changeStatusBodySchema,
        response: { 200: ticketDetailSchema, ...errors, 409: apiErrorSchema, 422: apiErrorSchema },
      },
    },
    async (request) => (await service.changeStatus(request.actor!, request.params.id, request.body)).ticket,
  );

  app.post(
    "/tickets/:id/reopen",
    {
      ...idempotent,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Reabrir ticket cerrado",
        description: "Lo puede hacer el solicitante dueño o un admin. Vuelve a Abierto y conserva el historial.",
        headers: idempotencyHeader,
        params: idParams,
        body: reopenBodySchema,
        response: { 200: ticketDetailSchema, ...errors, 409: apiErrorSchema, 422: apiErrorSchema },
      },
    },
    async (request) => service.reopen(request.actor!, request.params.id, request.body),
  );

  app.patch(
    "/tickets/:id/assignee",
    {
      ...authed,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Asignar responsable (solo admin)",
        params: idParams,
        body: assignBodySchema,
        response: { 200: ticketDetailSchema, ...errors, 409: apiErrorSchema },
      },
    },
    async (request) => service.assign(request.actor!, request.params.id, request.body),
  );

  app.patch(
    "/tickets/:id",
    {
      ...authed,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Cambiar prioridad, categoría o etiquetas (solo admin)",
        params: idParams,
        body: updateTicketBodySchema,
        response: { 200: ticketDetailSchema, ...errors, 409: apiErrorSchema },
      },
    },
    async (request) => service.update(request.actor!, request.params.id, request.body),
  );
};

export default ticketRoutes;
