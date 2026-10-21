import { sql, type Kysely, type Transaction } from "kysely";
import type { DB, TicketEventRow, TicketRow } from "../../db/types.js";

export type Visibility = "public" | "internal";

export type TicketEventInput = {
  ticket: TicketRow;
  type: string;
  visibility: Visibility;
  actorId: string | null;
  data?: Record<string, unknown>;
};

// Punto de extensión: 005 registra aquí la creación de notificaciones.
// Los listeners corren en la misma transacción: si fallan, se revierte todo.
export type TicketEventListener = (trx: Transaction<DB>, event: TicketEventRow, ticket: TicketRow) => Promise<void>;

const listeners: TicketEventListener[] = [];

export function onTicketEvent(listener: TicketEventListener) {
  listeners.push(listener);
  return () => {
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  };
}

// Registra el evento (auditoría de solo inserción) y actualiza la actividad del ticket.
// La actividad interna no cuenta como "sin leer" para el solicitante.
export async function recordEvent(trx: Transaction<DB>, input: TicketEventInput): Promise<TicketEventRow> {
  const event = await trx
    .insertInto("helpdesk.ticket_events")
    .values({
      ticket_id: input.ticket.id,
      actor_id: input.actorId,
      type: input.type,
      visibility: input.visibility,
      data: JSON.stringify(input.data ?? {}),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await trx
    .updateTable("helpdesk.tickets")
    .set({
      last_activity_at: sql`now()`,
      updated_at: sql`now()`,
      ...(input.visibility === "public" ? { last_public_activity_at: sql`now()` } : {}),
    })
    .where("id", "=", input.ticket.id)
    .execute();

  for (const listener of listeners) await listener(trx, event, input.ticket);
  return event;
}

// La actividad propia no se marca como "sin leer" para quien la hizo.
export async function markRead(db: Kysely<DB>, accountId: string, ticketId: string) {
  await db
    .insertInto("helpdesk.ticket_reads")
    .values({ account_id: accountId, ticket_id: ticketId, last_read_at: sql`now()` })
    .onConflict((oc) => oc.columns(["account_id", "ticket_id"]).doUpdateSet({ last_read_at: sql`now()` }))
    .execute();
}
