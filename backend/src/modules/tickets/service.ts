import { sql, type Transaction } from "kysely";
import {
  commentBodySchema,
  isAdmin,
  type Agent,
  type AssignBody,
  type ChangeStatusBody,
  type CommentBody,
  type CreateTicketBody,
  type Impact,
  type ListTicketsFilters,
  type ReopenBody,
  type TicketDetail,
  type TicketList,
  type TicketSource,
  type UpdateTicketBody,
} from "@reto/shared";
import type { Database } from "../../db/kysely.js";
import type { DB, TicketRow } from "../../db/types.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { markRead, recordEvent } from "./events.js";
import { isOwner } from "./policy.js";
import * as repo from "./repository.js";
import { toComment, toDetail, toSummary } from "./serializers.js";
import { reopen as reopenTransition, transition } from "./state-machine.js";

// Prioridad inicial según el impacto declarado. El admin la puede cambiar.
const PRIORITY_BY_IMPACT: Record<Impact, string> = { low: "low", medium: "medium", high: "high", critical: "urgent" };

const ticketNotFound = () => notFound("No encontramos este ticket o no tienes acceso a él.");

export type CreateOptions = {
  source: TicketSource;
  conversationId?: string | null;
  aiSummary?: Record<string, unknown> | null;
  attemptedSteps?: unknown[];
  incidentId?: string | null;
};

export function createTicketService(db: Database) {
  async function detail(actor: Agent, id: string, options: { markAsRead?: boolean } = {}): Promise<TicketDetail> {
    const row = await repo.findListRow(db, actor, id);
    if (!row) throw ticketNotFound();
    if (options.markAsRead) {
      await markRead(db, actor.id, id);
      row.unread = false;
    }
    const [comments, events, duplicateOf] = await Promise.all([
      repo.listComments(db, actor, id),
      repo.listEvents(db, actor, id),
      row.duplicate_of_ticket_id ? repo.findTicketRefById(db, row.duplicate_of_ticket_id) : Promise.resolve(undefined),
    ]);
    return toDetail(row, actor, { comments, events, duplicateOf: duplicateOf ?? null });
  }

  // Bloquea el ticket visible dentro de la transacción y aplica el control de versión.
  async function lockForUpdate(trx: Transaction<DB>, actor: Agent, id: string, version: number | null) {
    const ticket = await repo.findVisibleTicket(trx, actor, id, true);
    if (!ticket) throw ticketNotFound();
    if (version !== null && ticket.version !== version) throw new VersionConflict();
    return ticket;
  }

  // Si otro admin cambió el ticket, responde 409 con la versión actual para resolver el conflicto.
  async function withConflictDetails<T>(actor: Agent, id: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof VersionConflict)) throw error;
      throw new AppError(409, "version_conflict", "El ticket cambió mientras lo editabas. Revisa la versión actual.", {
        current: await detail(actor, id),
      });
    }
  }

  const service = {
    detail,

    // Recibe filtros ya validados (la ruta los parsea; otros llamadores usan listTicketsQuerySchema.parse).
    async list(actor: Agent, query: ListTicketsFilters): Promise<TicketList> {
      const { rows, total, counts } = await repo.listTickets(db, actor, query);
      return {
        items: rows.map((row) => toSummary(row, actor)),
        page: query.page,
        page_size: query.page_size,
        total,
        counts,
      };
    },

    // Dentro de una transacción ajena: la usa el asistente (spec 004) para crear el ticket
    // junto con el cambio de la conversación. El solicitante sale de la sesión.
    async createInTransaction(trx: Transaction<DB>, actor: Agent, input: CreateTicketBody, options: CreateOptions) {
      if (!(await repo.findActiveCategory(trx, input.category)))
        throw new AppError(400, "invalid_request", "La categoría no existe.", { fields: { category: "Categoría no válida" } });
      const impact = input.impact ?? "medium";
      const ticket = await trx
        .insertInto("helpdesk.tickets")
        .values({
          title: input.title.trim(),
          original_description: input.description,
          requester_id: actor.id,
          category_code: input.category,
          impact,
          priority_code: PRIORITY_BY_IMPACT[impact],
          source: options.source,
          conversation_id: options.conversationId ?? null,
          incident_id: options.incidentId ?? null,
          ai_summary: options.aiSummary ? JSON.stringify(options.aiSummary) : null,
          attempted_steps: JSON.stringify(options.attemptedSteps ?? []),
          assignee_id: null,
          closure_reason: null,
          resolution_summary: null,
          duplicate_of_ticket_id: null,
          first_response_at: null,
          last_team_reply_at: null,
          last_requester_reply_at: null,
          closed_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await recordEvent(trx, { ticket, type: "created", visibility: "public", actorId: actor.id, data: { source: options.source } });
      await markRead(trx, actor.id, ticket.id);
      return ticket;
    },

    async create(actor: Agent, input: CreateTicketBody, options: CreateOptions): Promise<TicketDetail> {
      const ticket = await db.transaction().execute((trx) => service.createInTransaction(trx, actor, input, options));
      return detail(actor, ticket.id);
    },

    async comment(actor: Agent, id: string, input: CommentBody) {
      const body = commentBodySchema.parse(input);
      const admin = isAdmin(actor);
      if (!admin && (body.visibility === "internal" || body.requests_info))
        throw forbidden("Solo el equipo de soporte puede dejar notas internas o pedir información.");
      if (body.visibility === "internal" && body.requests_info)
        throw new AppError(400, "invalid_request", "Una solicitud de información debe ser un comentario público.");

      const comment = await db.transaction().execute(async (trx) => {
        const ticket = await lockForUpdate(trx, actor, id, null);
        if (ticket.status === "closed" && body.visibility === "public")
          throw new AppError(409, "ticket_closed", "El ticket está cerrado. Reábrelo para seguir la conversación.");
        const created = await trx
          .insertInto("helpdesk.ticket_comments")
          .values({
            ticket_id: id,
            author_id: actor.id,
            visibility: body.visibility,
            body: body.body,
            requests_info: body.requests_info,
            edited_at: null,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        const fromTeam = actor.id !== ticket.requester_id;
        if (body.visibility === "public")
          await trx
            .updateTable("helpdesk.tickets")
            .set(
              fromTeam
                ? { first_response_at: sql`coalesce(first_response_at, now())`, last_team_reply_at: sql`now()` }
                : { last_requester_reply_at: sql`now()` },
            )
            .where("id", "=", id)
            .execute();
        await recordEvent(trx, {
          ticket,
          type: "comment_added",
          visibility: body.visibility,
          actorId: actor.id,
          data: { comment_id: created.id, requests_info: body.requests_info, from_team: fromTeam },
        });
        await markRead(trx, actor.id, id);
        return { ...created, requester_id: ticket.requester_id };
      });
      return toComment({ ...comment, author_name: actor.name, author_role: actor.role }, comment.requester_id);
    },

    // Corregir un comentario conserva el texto anterior (trazabilidad, §09).
    async editComment(actor: Agent, id: string, commentId: string, body: string) {
      const result = await db.transaction().execute(async (trx) => {
        const ticket = await lockForUpdate(trx, actor, id, null);
        const comment = await trx
          .selectFrom("helpdesk.ticket_comments")
          .selectAll()
          .where("id", "=", commentId)
          .where("ticket_id", "=", id)
          .executeTakeFirst();
        if (!comment || (comment.visibility === "internal" && !isAdmin(actor)))
          throw notFound("No encontramos este comentario.");
        if (comment.author_id !== actor.id) throw forbidden("Solo quien escribió el comentario puede corregirlo.");
        if (comment.body === body.trim()) return { comment, requesterId: ticket.requester_id };
        await trx
          .insertInto("helpdesk.ticket_comment_revisions")
          .values({ comment_id: commentId, previous_body: comment.body, edited_by: actor.id })
          .execute();
        const updated = await trx
          .updateTable("helpdesk.ticket_comments")
          .set({ body: body.trim(), edited_at: sql`now()` })
          .where("id", "=", commentId)
          .returningAll()
          .executeTakeFirstOrThrow();
        await recordEvent(trx, {
          ticket,
          type: "comment_edited",
          visibility: comment.visibility,
          actorId: actor.id,
          data: { comment_id: commentId },
        });
        return { comment: updated, requesterId: ticket.requester_id };
      });
      return toComment({ ...result.comment, author_name: actor.name, author_role: actor.role }, result.requesterId);
    },

    async changeStatus(actor: Agent, id: string, body: ChangeStatusBody) {
      if (!isAdmin(actor)) {
        const visible = await repo.findVisibleTicket(db, actor, id);
        if (!visible) throw ticketNotFound();
        throw forbidden("Solo el equipo de soporte puede cambiar el estado.");
      }
      return withConflictDetails(actor, id, async () => {
        const changed = await db.transaction().execute(async (trx) => {
          const current = await lockForUpdate(trx, actor, id, null);
          // Un clic repetido con el mismo estado no es una nueva transición (ni conflicto).
          if (current.status === body.status) return false;
          if (current.version !== body.version) throw new VersionConflict();

          let duplicateOfId: string | null = null;
          if (body.closure_reason === "duplicate" && body.duplicate_of_number !== undefined) {
            const original = await repo.findTicketIdByNumber(trx, body.duplicate_of_number);
            if (!original || original.id === id)
              throw new AppError(422, "resolution_required", "El ticket original indicado no existe.");
            duplicateOfId = original.id;
          }
          const result = transition(current.status, body.status, {
            closure_reason: body.closure_reason,
            resolution_summary: body.resolution_summary,
            duplicate_of_ticket_id: duplicateOfId,
          });
          if (result.kind === "error") throw new AppError(422, result.code, result.message);
          if (result.kind === "noop") return false;

          const closing = result.changes.status === "closed";
          await trx
            .updateTable("helpdesk.tickets")
            .set({
              ...result.changes,
              closed_at: closing ? sql`now()` : null,
              version: sql`version + 1`,
            })
            .where("id", "=", id)
            .execute();
          await recordEvent(trx, {
            ticket: current,
            type: "status_changed",
            visibility: "public",
            actorId: actor.id,
            data: {
              from: current.status,
              to: result.changes.status,
              ...(closing
                ? {
                    closure_reason: result.changes.closure_reason,
                    resolution_summary: result.changes.resolution_summary,
                    ...(body.duplicate_of_number ? { duplicate_of_number: body.duplicate_of_number } : {}),
                  }
                : {}),
            },
          });
          await markRead(trx, actor.id, id);
          return true;
        });
        return { changed, ticket: await detail(actor, id) };
      });
    },

    async reopen(actor: Agent, id: string, body: ReopenBody) {
      return withConflictDetails(actor, id, async () => {
        await db.transaction().execute(async (trx) => {
          const current = await lockForUpdate(trx, actor, id, body.version);
          if (!isAdmin(actor) && !isOwner(actor, current)) throw ticketNotFound();
          const result = reopenTransition(current.status);
          if (result.kind === "error") throw new AppError(422, result.code, result.message);
          await trx
            .updateTable("helpdesk.tickets")
            .set({
              ...result.changes,
              closed_at: null,
              reopened_count: sql`reopened_count + 1`,
              version: sql`version + 1`,
            })
            .where("id", "=", id)
            .execute();
          await recordEvent(trx, {
            ticket: current,
            type: "reopened",
            visibility: "public",
            actorId: actor.id,
            data: { from: "closed", to: "open", reason: body.reason, by_team: actor.id !== current.requester_id },
          });
          await markRead(trx, actor.id, id);
        });
        return detail(actor, id);
      });
    },

    async assign(actor: Agent, id: string, body: AssignBody) {
      await requireVisibleAdmin(actor, id);
      return withConflictDetails(actor, id, async () => {
        await db.transaction().execute(async (trx) => {
          const current = await lockForUpdate(trx, actor, id, body.version);
          if (current.assignee_id === body.assignee_id) return;
          const assignee = body.assignee_id ? await repo.findAdmin(trx, body.assignee_id) : null;
          if (body.assignee_id && !assignee)
            throw new AppError(400, "invalid_request", "Solo se puede asignar a un administrador de soporte.", {
              fields: { assignee_id: "No es un administrador" },
            });
          await trx
            .updateTable("helpdesk.tickets")
            .set({ assignee_id: body.assignee_id, version: sql`version + 1` })
            .where("id", "=", id)
            .execute();
          await recordEvent(trx, {
            ticket: current,
            type: "assigned",
            visibility: "internal",
            actorId: actor.id,
            data: { from: current.assignee_id, to: body.assignee_id, to_name: assignee?.name ?? null },
          });
          await markRead(trx, actor.id, id);
        });
        return detail(actor, id);
      });
    },

    async update(actor: Agent, id: string, body: UpdateTicketBody) {
      await requireVisibleAdmin(actor, id);
      return withConflictDetails(actor, id, async () => {
        await db.transaction().execute(async (trx) => {
          const current = await lockForUpdate(trx, actor, id, body.version);
          const changes: Partial<Pick<TicketRow, "priority_code" | "category_code" | "tags">> = {};
          const events: { type: string; data: Record<string, unknown> }[] = [];
          if (body.priority !== undefined && body.priority !== current.priority_code) {
            if (!(await repo.findActivePriority(trx, body.priority)))
              throw new AppError(400, "invalid_request", "La prioridad no existe.", { fields: { priority: "No válida" } });
            changes.priority_code = body.priority;
            events.push({ type: "priority_changed", data: { from: current.priority_code, to: body.priority } });
          }
          if (body.category !== undefined && body.category !== current.category_code) {
            if (!(await repo.findActiveCategory(trx, body.category)))
              throw new AppError(400, "invalid_request", "La categoría no existe.", { fields: { category: "No válida" } });
            changes.category_code = body.category;
            events.push({ type: "category_changed", data: { from: current.category_code, to: body.category } });
          }
          if (body.tags !== undefined) {
            const tags = [...new Set(body.tags.map((tag) => tag.toLowerCase()))].sort();
            if (tags.join(",") !== [...current.tags].sort().join(",")) {
              changes.tags = tags;
              events.push({ type: "tags_changed", data: { from: current.tags, to: tags } });
            }
          }
          if (events.length === 0) return;
          await trx
            .updateTable("helpdesk.tickets")
            .set({ ...changes, version: sql`version + 1` })
            .where("id", "=", id)
            .execute();
          for (const event of events)
            await recordEvent(trx, { ticket: current, ...event, visibility: "internal", actorId: actor.id });
          await markRead(trx, actor.id, id);
        });
        return detail(actor, id);
      });
    },

  };
  return service;

  // 404 si el ticket no es visible; 403 si es visible pero el actor no es admin.
  async function requireVisibleAdmin(actor: Agent, id: string) {
    if (isAdmin(actor)) return;
    const visible = await repo.findVisibleTicket(db, actor, id);
    if (!visible) throw ticketNotFound();
    throw forbidden("Solo el equipo de soporte puede hacer este cambio.");
  }
}

class VersionConflict extends Error {}

export type TicketService = ReturnType<typeof createTicketService>;
