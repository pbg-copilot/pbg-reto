import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  apiErrorSchema,
  deliverySchema,
  listNotificationsQuerySchema,
  notificationListSchema,
  notificationSchema,
  unreadCountSchema,
} from "@reto/shared";
import type { NotificationService } from "./service.js";

const idParams = z.object({ id: z.uuid() });
const security: Record<string, string[]>[] = [{ bearer: [] }, { cookie: [] }];
const errors = { 400: apiErrorSchema, 401: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema };

const notificationRoutes: FastifyPluginAsyncZod<{ service: NotificationService }> = async (app, { service }) => {
  const authed = { preValidation: app.requireAuth };
  const admin = { preValidation: app.requireAdmin };
  const tags = ["notifications"];

  app.get(
    "/notifications",
    {
      ...authed,
      schema: {
        tags,
        security,
        summary: "Bandeja de notificaciones",
        description: "Solo las propias, de la más nueva a la más antigua. `unread=true` filtra las no leídas.",
        querystring: listNotificationsQuerySchema,
        response: { 200: notificationListSchema, ...errors },
      },
    },
    async (request) => service.list(request.actor!, request.query),
  );

  app.get(
    "/notifications/unread-count",
    {
      ...authed,
      schema: {
        tags,
        security,
        summary: "Contador de no leídas (para la campana)",
        response: { 200: unreadCountSchema, ...errors },
      },
    },
    async (request) => ({ count: await service.unreadCount(request.actor!) }),
  );

  app.patch(
    "/notifications/:id/read",
    {
      ...authed,
      schema: {
        tags,
        security,
        summary: "Marcar como leída",
        description: "Idempotente. Una notificación ajena responde 404.",
        params: idParams,
        response: { 200: notificationSchema, ...errors },
      },
    },
    async (request) => service.markRead(request.actor!, request.params.id),
  );

  app.post(
    "/notifications/read-all",
    {
      ...authed,
      schema: {
        tags,
        security,
        summary: "Marcar todas como leídas",
        description: "Idempotente por naturaleza: no requiere Idempotency-Key.",
        response: { 200: z.object({ updated: z.number().int() }), ...errors },
      },
    },
    async (request) => service.markAllRead(request.actor!),
  );

  app.get(
    "/tickets/:id/deliveries",
    {
      ...admin,
      schema: {
        tags,
        security,
        summary: "Entregas de las notificaciones de un ticket (solo admin)",
        description: "Estado por canal: entregada, pendiente o fallida. No incluye correos.",
        params: idParams,
        response: { 200: z.array(deliverySchema), ...errors },
      },
    },
    async (request) => service.deliveriesForTicket(request.params.id),
  );

  app.post(
    "/notifications/deliveries/:id/retry",
    {
      ...admin,
      schema: {
        tags,
        security,
        summary: "Reintentar un correo fallido (solo admin)",
        params: idParams,
        response: { 204: z.undefined(), ...errors, 409: apiErrorSchema },
      },
    },
    async (request, reply) => {
      await service.retryDelivery(request.params.id);
      return reply.code(204).send();
    },
  );
};

export default notificationRoutes;
