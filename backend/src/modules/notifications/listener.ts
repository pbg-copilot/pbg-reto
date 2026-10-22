import { sql, type Transaction } from "kysely";
import type { DB } from "../../db/types.js";
import { enqueue } from "../../jobs/queue.js";
import type { TicketEventListener } from "../tickets/events.js";
import { needsTeam, planNotifications } from "./plan.js";

export const DELIVER_EMAIL_JOB = "deliver_email";
// 10 s, 20 s, 40 s, 80 s y 160 s entre intentos: unos 5 minutos en total.
export const EMAIL_MAX_ATTEMPTS = 6;

export const emailJobKey = (deliveryId: string) => `email:${deliveryId}`;

async function teamFor(trx: Transaction<DB>, assigneeId: string | null) {
  if (assigneeId) return [assigneeId];
  const admins = await trx.selectFrom("reto.agents").select("id").where("role", "=", "admin").execute();
  return admins.map((admin) => admin.id);
}

// Corre dentro de la transacción del cambio (outbox): si algo falla, se revierte
// también la transición. El correo se encola en la misma transacción.
export function createNotificationListener(options: { email: boolean }): TicketEventListener {
  return async (trx, event, ticket) => {
    const data = event.data as Record<string, unknown>;
    const team = needsTeam({ ...event, data }) ? await teamFor(trx, ticket.assignee_id) : [];

    const requesterName = team.length
      ? ((await trx.selectFrom("reto.agents").select("name").where("id", "=", ticket.requester_id).executeTakeFirst())?.name ??
        "El solicitante")
      : "";

    let commentBody: string | null = null;
    if (event.type === "comment_added" && event.visibility === "public" && typeof data.comment_id === "string") {
      const comment = await trx
        .selectFrom("helpdesk.ticket_comments")
        .select(["body", "visibility"])
        .where("id", "=", data.comment_id)
        .executeTakeFirst();
      if (comment?.visibility === "public") commentBody = comment.body;
    }

    const priority =
      event.type === "assigned"
        ? ((await trx.selectFrom("helpdesk.priorities").select(["code", "name"]).where("code", "=", ticket.priority_code).executeTakeFirst()) ?? null)
        : null;

    const planned = planNotifications({ ...event, data }, ticket, { team, requesterName, commentBody, priority });
    for (const item of planned) {
      const inserted = await trx
        .insertInto("helpdesk.notifications")
        .values({
          recipient_id: item.recipientId,
          ticket_id: ticket.id,
          type: item.type,
          title: item.title,
          body: item.body,
          payload: JSON.stringify(item.payload),
          link: item.link,
          source_event_id: event.id,
          dedupe_key: `${event.id}:${item.recipientId}`,
          read_at: null,
        })
        .onConflict((oc) => oc.column("dedupe_key").doNothing())
        .returning("id")
        .executeTakeFirst();
      if (!inserted) continue;

      await trx
        .insertInto("helpdesk.notification_deliveries")
        .values({
          notification_id: inserted.id,
          channel: "in_app",
          status: "delivered",
          attempts: 1,
          last_error: null,
          delivered_at: sql`now()`,
        })
        .execute();

      if (!options.email || !item.email) continue;
      const delivery = await trx
        .insertInto("helpdesk.notification_deliveries")
        .values({ notification_id: inserted.id, channel: "email", status: "pending", last_error: null, delivered_at: null })
        .returning("id")
        .executeTakeFirstOrThrow();
      await enqueue(trx, {
        type: DELIVER_EMAIL_JOB,
        payload: { delivery_id: delivery.id },
        dedupeKey: emailJobKey(delivery.id),
        maxAttempts: EMAIL_MAX_ATTEMPTS,
      });
    }
  };
}
