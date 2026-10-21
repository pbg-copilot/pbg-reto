import { sql, type Kysely } from "kysely";
import { isAdmin, parseTicketNumber, type Agent, type ListTicketsFilters } from "@reto/shared";
import type { CommentRow, DB, TicketEventRow, TicketRow } from "../../db/types.js";

// Todas las consultas reciben al actor: el filtro de visibilidad va en el SQL,
// nunca después. Un solicitante solo ve sus tickets y nada interno.

type Db = Kysely<DB>;
type ParsedQuery = ListTicketsFilters;

export type TicketListRow = TicketRow & {
  requester_name: string;
  assignee_name: string | null;
  priority_rank: number;
  activity_at: Date;
  unread: boolean;
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

// La actividad que ve cada rol: el solicitante solo la pública.
const activityColumn = (actor: Agent) => (isAdmin(actor) ? "t.last_activity_at" : "t.last_public_activity_at");

function scopedTickets(db: Db, actor: Agent) {
  let query = db
    .selectFrom("helpdesk.tickets as t")
    .innerJoin("reto.agents as r", "r.id", "t.requester_id")
    .leftJoin("reto.agents as a", "a.id", "t.assignee_id")
    .innerJoin("helpdesk.priorities as p", "p.code", "t.priority_code")
    .leftJoin("helpdesk.ticket_reads as tr", (join) =>
      join.onRef("tr.ticket_id", "=", "t.id").on("tr.account_id", "=", actor.id),
    );
  if (!isAdmin(actor)) query = query.where("t.requester_id", "=", actor.id);
  return query;
}

type Scoped = ReturnType<typeof scopedTickets>;

function unreadExpression(actor: Agent) {
  return sql<boolean>`${sql.ref(activityColumn(actor))} > coalesce(tr.last_read_at, '-infinity'::timestamptz)`;
}

function applyFilters(query: Scoped, actor: Agent, filters: ParsedQuery, includeView: boolean): Scoped {
  const admin = isAdmin(actor);
  if (includeView && filters.view) query = query.where("t.status", "=", filters.view);
  if (filters.q) {
    const number = parseTicketNumber(filters.q);
    const pattern = `%${escapeLike(filters.q)}%`;
    query = query.where((eb) =>
      eb.or([
        ...(number !== null ? [eb("t.number", "=", number)] : []),
        eb(sql`helpdesk.immutable_unaccent(t.title)`, "ilike", sql`helpdesk.immutable_unaccent(${pattern})`),
        eb("t.original_description", "ilike", pattern),
      ]),
    );
  }
  if (filters.category) query = query.where("t.category_code", "=", filters.category);
  if (filters.priority) query = query.where("t.priority_code", "=", filters.priority);
  if (filters.age) {
    const hours = { gt_24h: 24, gt_72h: 72, gt_7d: 168 }[filters.age];
    query = query.where("t.created_at", "<", sql<Date>`now() - make_interval(hours => ${hours})`);
  }
  if (filters.unread) query = query.where(unreadExpression(actor));
  // Filtros solo para el equipo; para un solicitante se ignoran.
  if (admin) {
    if (filters.assignee === "me") query = query.where("t.assignee_id", "=", actor.id);
    else if (filters.assignee === "unassigned") query = query.where("t.assignee_id", "is", null);
    else if (filters.assignee) query = query.where("t.assignee_id", "=", filters.assignee);
    if (filters.requester) query = query.where("t.requester_id", "=", filters.requester);
    if (filters.unattended)
      query = query.where("t.status", "=", "open").where("t.first_response_at", "is", null);
  }
  return query;
}

function selectListColumns(query: Scoped, actor: Agent) {
  return query
    .selectAll("t")
    .select([
      "r.name as requester_name",
      "a.name as assignee_name",
      "p.rank as priority_rank",
      sql<Date>`${sql.ref(activityColumn(actor))}`.as("activity_at"),
      unreadExpression(actor).as("unread"),
    ]);
}

export async function listTickets(db: Db, actor: Agent, filters: ParsedQuery) {
  const sortColumn = {
    updated_at: sql.ref(activityColumn(actor)),
    created_at: sql.ref("t.created_at"),
    priority: sql.ref("p.rank"),
    number: sql.ref("t.number"),
  }[filters.sort];
  const direction = filters.order === "asc" ? sql`asc` : sql`desc`;

  const rows = (await selectListColumns(applyFilters(scopedTickets(db, actor), actor, filters, true), actor)
    .orderBy(sql`${sortColumn} ${direction}`)
    .orderBy("t.number", "desc")
    .limit(filters.page_size)
    .offset((filters.page - 1) * filters.page_size)
    .execute()) as TicketListRow[];

  const totals = await applyFilters(scopedTickets(db, actor), actor, filters, false)
    .select(["t.status", sql<number>`count(*)::int`.as("n")])
    .groupBy("t.status")
    .execute();
  const counts = { open: 0, in_review: 0, closed: 0 };
  for (const row of totals) counts[row.status as keyof typeof counts] = row.n;
  const total = filters.view
    ? counts[filters.view]
    : counts.open + counts.in_review + counts.closed;

  return { rows, total, counts };
}

// Ticket visible para el actor (o undefined). forUpdate bloquea la fila dentro de una transacción.
export async function findVisibleTicket(db: Db, actor: Agent, id: string, forUpdate = false) {
  let query = db.selectFrom("helpdesk.tickets").selectAll().where("id", "=", id);
  if (!isAdmin(actor)) query = query.where("requester_id", "=", actor.id);
  if (forUpdate) query = query.forUpdate();
  return query.executeTakeFirst();
}

export async function findListRow(db: Db, actor: Agent, id: string) {
  return (await selectListColumns(scopedTickets(db, actor), actor).where("t.id", "=", id).executeTakeFirst()) as
    | TicketListRow
    | undefined;
}

export type CommentWithAuthor = CommentRow & { author_name: string; author_role: string };

export async function listComments(db: Db, actor: Agent, ticketId: string): Promise<CommentWithAuthor[]> {
  let query = db
    .selectFrom("helpdesk.ticket_comments as c")
    .innerJoin("reto.agents as u", "u.id", "c.author_id")
    .selectAll("c")
    .select(["u.name as author_name", "u.role as author_role"])
    .where("c.ticket_id", "=", ticketId);
  if (!isAdmin(actor)) query = query.where("c.visibility", "=", "public");
  return query.orderBy("c.created_at", "asc").orderBy("c.id", "asc").execute();
}

export type EventWithActor = TicketEventRow & { actor_name: string | null };

export async function listEvents(db: Db, actor: Agent, ticketId: string): Promise<EventWithActor[]> {
  let query = db
    .selectFrom("helpdesk.ticket_events as e")
    .leftJoin("reto.agents as u", "u.id", "e.actor_id")
    .selectAll("e")
    .select("u.name as actor_name")
    .where("e.ticket_id", "=", ticketId);
  if (!isAdmin(actor)) query = query.where("e.visibility", "=", "public");
  return query.orderBy("e.id", "asc").execute();
}

export async function findTicketRefById(db: Db, id: string) {
  return db.selectFrom("helpdesk.tickets").select(["id", "number"]).where("id", "=", id).executeTakeFirst();
}

export async function findTicketIdByNumber(db: Db, number: number) {
  return db.selectFrom("helpdesk.tickets").select(["id", "number"]).where("number", "=", number).executeTakeFirst();
}

export async function findActiveCategory(db: Db, code: string) {
  return db
    .selectFrom("helpdesk.categories")
    .select("code")
    .where("code", "=", code)
    .where("is_active", "=", true)
    .executeTakeFirst();
}

export async function findActivePriority(db: Db, code: string) {
  return db
    .selectFrom("helpdesk.priorities")
    .select("code")
    .where("code", "=", code)
    .where("is_active", "=", true)
    .executeTakeFirst();
}

export async function findAdmin(db: Db, id: string) {
  return db
    .selectFrom("reto.agents")
    .select(["id", "name"])
    .where("id", "=", id)
    .where("role", "=", "admin")
    .executeTakeFirst();
}


export async function findIncident(db: Db, id: string) {
  return db.selectFrom("helpdesk.incidents").select(["id", "title", "status"]).where("id", "=", id).executeTakeFirst();
}
