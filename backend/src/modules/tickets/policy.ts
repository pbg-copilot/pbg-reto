import { isAdmin, type Agent, type TicketPermissions, type TicketStatus } from "@reto/shared";

// Matriz de permisos (specs/000-overview/domain.md). La visibilidad se aplica también
// en las consultas SQL; esto decide qué acciones puede hacer el actor sobre un ticket visible.

type TicketLike = { requester_id: string; status: TicketStatus };

export const isOwner = (actor: Agent, ticket: TicketLike) => ticket.requester_id === actor.id;

export const canView = (actor: Agent, ticket: TicketLike) => isAdmin(actor) || isOwner(actor, ticket);

export function permissionsFor(actor: Agent, ticket: TicketLike): TicketPermissions {
  const admin = isAdmin(actor);
  const participant = admin || isOwner(actor, ticket);
  const closed = ticket.status === "closed";
  return {
    can_comment: participant && !closed,
    // El equipo puede dejar notas internas incluso con el ticket cerrado.
    can_add_internal_note: admin,
    can_change_status: admin && !closed,
    can_reopen: participant && closed,
    can_assign: admin,
    can_edit_attributes: admin,
    // Pedir información solo tiene sentido del equipo hacia otra persona.
    can_request_info: admin && !isOwner(actor, ticket) && !closed,
    can_attach: participant && !closed,
    can_remove_attachments: admin,
  };
}
