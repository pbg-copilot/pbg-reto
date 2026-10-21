import { sql } from "kysely";
import type { Agent, Delivery, ListNotificationsQuery, Notification, NotificationList, NotificationType } from "@reto/shared";
import type { Database } from "../../db/kysely.js";
import type { NotificationRow } from "../../db/types.js";
import { AppError, notFound } from "../../lib/errors.js";
import { enqueue } from "../../jobs/queue.js";
import { DELIVER_EMAIL_JOB, EMAIL_MAX_ATTEMPTS, emailJobKey } from "./listener.js";

const notificationNotFound = () => notFound("No encontramos esta notificación.");

const toNotification = (row: NotificationRow): Notification => ({
  id: row.id,
  type: row.type as NotificationType,
  title: row.title,
  body: row.body,
  payload: row.payload as Notification["payload"],
  link: row.link,
  read_at: row.read_at?.toISOString() ?? null,
  created_at: row.created_at.toISOString(),
});

// Cada consulta filtra por destinatario en el SQL: una notificación ajena da 404.
export function createNotificationService(db: Database) {
  const own = (actor: Agent) => db.selectFrom("helpdesk.notifications").where("recipient_id", "=", actor.id);

  async function unreadCount(actor: Agent) {
    const row = await own(actor)
      .where("read_at", "is", null)
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  return {
    unreadCount,

    async list(actor: Agent, query: ListNotificationsQuery): Promise<NotificationList> {
      const scoped = query.unread ? own(actor).where("read_at", "is", null) : own(actor);
      const [rows, total, unread] = await Promise.all([
        scoped
          .selectAll()
          .orderBy("created_at", "desc")
          .orderBy("id")
          .limit(query.page_size)
          .offset((query.page - 1) * query.page_size)
          .execute(),
        scoped.select((eb) => eb.fn.countAll<string>().as("count")).executeTakeFirstOrThrow(),
        unreadCount(actor),
      ]);
      return {
        items: rows.map(toNotification),
        page: query.page,
        page_size: query.page_size,
        total: Number(total.count),
        unread_count: unread,
      };
    },

    // Idempotente: marcar dos veces conserva la primera fecha de lectura.
    async markRead(actor: Agent, id: string) {
      const row = await db
        .updateTable("helpdesk.notifications")
        .set({ read_at: sql`coalesce(read_at, now())` })
        .where("id", "=", id)
        .where("recipient_id", "=", actor.id)
        .returningAll()
        .executeTakeFirst();
      if (!row) throw notificationNotFound();
      return toNotification(row);
    },

    async markAllRead(actor: Agent) {
      const result = await db
        .updateTable("helpdesk.notifications")
        .set({ read_at: sql`now()` })
        .where("recipient_id", "=", actor.id)
        .where("read_at", "is", null)
        .executeTakeFirst();
      return { updated: Number(result.numUpdatedRows) };
    },

    // Solo admin (lo verifica la ruta). Sin correos: el admin ve a quién y por qué canal.
    async deliveriesForTicket(ticketId: string): Promise<Delivery[]> {
      const ticket = await db.selectFrom("helpdesk.tickets").select("id").where("id", "=", ticketId).executeTakeFirst();
      if (!ticket) throw notFound("No encontramos este ticket o no tienes acceso a él.");
      const rows = await db
        .selectFrom("helpdesk.notification_deliveries as d")
        .innerJoin("helpdesk.notifications as n", "n.id", "d.notification_id")
        .innerJoin("reto.agents as a", "a.id", "n.recipient_id")
        .select([
          "d.id",
          "n.type",
          "a.id as recipient_id",
          "a.name as recipient_name",
          "d.channel",
          "d.status",
          "d.attempts",
          "d.last_error",
          "d.created_at",
          "d.delivered_at",
        ])
        .where("n.ticket_id", "=", ticketId)
        .orderBy("d.created_at", "desc")
        .orderBy("d.channel")
        .limit(100)
        .execute();
      return rows.map((row) => ({
        id: row.id,
        notification_type: row.type as NotificationType,
        recipient: { id: row.recipient_id, name: row.recipient_name },
        channel: row.channel,
        status: row.status,
        attempts: row.attempts,
        last_error: row.last_error,
        created_at: row.created_at.toISOString(),
        delivered_at: row.delivered_at?.toISOString() ?? null,
      }));
    },

    // Vuelve a encolar una entrega de correo fallida: reinicia su job (misma dedupe_key).
    async retryDelivery(id: string) {
      await db.transaction().execute(async (trx) => {
        const delivery = await trx
          .selectFrom("helpdesk.notification_deliveries")
          .select(["id", "channel", "status"])
          .where("id", "=", id)
          .forUpdate()
          .executeTakeFirst();
        if (!delivery) throw notFound("No encontramos esta entrega.");
        if (delivery.channel !== "email" || delivery.status !== "failed")
          throw new AppError(409, "invalid_transition", "Solo se puede reintentar un correo que falló.");
        await trx
          .updateTable("helpdesk.notification_deliveries")
          .set({ status: "pending", updated_at: sql`now()` })
          .where("id", "=", id)
          .execute();
        const job = await trx
          .updateTable("helpdesk.jobs")
          .set({ status: "queued", attempts: 0, run_at: sql`now()`, locked_by: null, locked_until: null, updated_at: sql`now()` })
          .where("dedupe_key", "=", emailJobKey(id))
          .executeTakeFirst();
        // El job pudo borrarse en una limpieza: se crea de nuevo.
        if (Number(job.numUpdatedRows) === 0)
          await enqueue(trx, {
            type: DELIVER_EMAIL_JOB,
            payload: { delivery_id: id },
            dedupeKey: emailJobKey(id),
            maxAttempts: EMAIL_MAX_ATTEMPTS,
          });
      });
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
