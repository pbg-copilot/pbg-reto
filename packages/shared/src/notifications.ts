import { z } from "zod";
import { paginatedSchema, paginationQuerySchema } from "./pagination.js";

// Notificaciones (specs/005-notifications). Códigos en inglés, textos en español.

export const NOTIFICATION_TYPES = [
  "ticket_created", // al solicitante: confirmación
  "new_ticket", // al equipo
  "status_changed",
  "team_comment",
  "info_requested",
  "requester_replied", // al equipo
  "ticket_reopened",
  "ticket_assigned", // al nuevo responsable
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationTypeLabel: Record<NotificationType, string> = {
  ticket_created: "Confirmación de creación",
  new_ticket: "Nuevo ticket",
  status_changed: "Cambio de estado",
  team_comment: "Respuesta del equipo",
  info_requested: "Solicitud de información",
  requester_replied: "Respuesta del solicitante",
  ticket_reopened: "Reapertura",
  ticket_assigned: "Asignación",
};

export const DELIVERY_CHANNELS = ["in_app", "email"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
export const DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const deliveryStatusLabel: Record<DeliveryStatus, string> = {
  pending: "Pendiente",
  delivered: "Entregada",
  failed: "Fallida",
};
export const deliveryChannelLabel: Record<DeliveryChannel, string> = {
  in_app: "En la app",
  email: "Correo",
};

const isoDate = z.string().describe("Fecha ISO 8601 (UTC)");

export const notificationSchema = z.object({
  id: z.string(),
  type: z.enum(NOTIFICATION_TYPES),
  title: z.string().describe('Por ejemplo: "TCK-000042 pasó de Abierto a En revisión"'),
  body: z.string(),
  payload: z.object({
    display_number: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    at: isoDate.optional(),
    excerpt: z.string().optional(),
  }),
  link: z.string().describe("Ruta de la app; al abrirla, la API vuelve a verificar permisos"),
  read_at: isoDate.nullable(),
  created_at: isoDate,
});
export type Notification = z.infer<typeof notificationSchema>;

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export const notificationListSchema = paginatedSchema(notificationSchema).extend({
  unread_count: z.number().int(),
});
export type NotificationList = z.infer<typeof notificationListSchema>;

export const unreadCountSchema = z.object({ count: z.number().int() });

export const deliverySchema = z.object({
  id: z.string(),
  notification_type: z.enum(NOTIFICATION_TYPES),
  recipient: z.object({ id: z.string(), name: z.string() }),
  channel: z.enum(DELIVERY_CHANNELS),
  status: z.enum(DELIVERY_STATUSES),
  attempts: z.number().int(),
  last_error: z.string().nullable(),
  created_at: isoDate,
  delivered_at: isoDate.nullable(),
});
export type Delivery = z.infer<typeof deliverySchema>;
