import {
  closureReasonLabel,
  displayNumber,
  statusLabel,
  type ClosureReason,
  type NotificationType,
  type TicketStatus,
} from "@reto/shared";

// Qué notificación recibe cada quien por cada evento (tabla de specs/005-notifications/spec.md).
// Función pura: el listener le pasa los datos ya consultados y luego inserta el resultado.

export type PlanEvent = {
  id: number;
  type: string;
  visibility: "public" | "internal";
  actor_id: string | null;
  data: Record<string, unknown>;
  created_at: Date;
};

export type PlanTicket = {
  id: string;
  number: number;
  title: string;
  requester_id: string;
  assignee_id: string | null;
};

export type PlanContext = {
  // Responsable del ticket o, si no tiene, todos los admins.
  team: string[];
  requesterName: string;
  // Solo comentarios públicos: una nota interna nunca llega aquí.
  commentBody: string | null;
};

export type PlannedNotification = {
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: { display_number: string; from?: string; to?: string; at: string; excerpt?: string };
  link: string;
  // El correo solo se ofrece al solicitante.
  email: boolean;
};

export const EXCERPT_LENGTH = 140;

export function excerpt(text: string, max = EXCERPT_LENGTH) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

const label = (status: unknown) => statusLabel[status as TicketStatus] ?? String(status);

// Eventos que necesitan conocer al equipo (el listener solo consulta admins si hace falta).
export function needsTeam(event: Pick<PlanEvent, "type" | "visibility" | "data">) {
  if (event.visibility !== "public") return false;
  if (event.type === "created" || event.type === "reopened") return true;
  return event.type === "comment_added" && event.data.from_team === false;
}

export function planNotifications(event: PlanEvent, ticket: PlanTicket, context: PlanContext): PlannedNotification[] {
  const number = displayNumber(ticket.number);
  const base = { display_number: number, at: event.created_at.toISOString() };
  const link = `/tickets/${ticket.id}`;
  const out: PlannedNotification[] = [];
  const toRequester = (type: NotificationType, title: string, body: string, extra: Partial<PlannedNotification["payload"]> = {}) =>
    out.push({ recipientId: ticket.requester_id, type, title, body, payload: { ...base, ...extra }, link, email: true });
  const toTeam = (recipients: string[], type: NotificationType, title: string, body: string, extra: Partial<PlannedNotification["payload"]> = {}) => {
    for (const recipientId of recipients)
      out.push({ recipientId, type, title, body, payload: { ...base, ...extra }, link, email: false });
  };

  if (event.visibility === "internal") {
    // Lo interno solo puede avisar al equipo: hoy, la asignación al nuevo responsable.
    if (event.type === "assigned" && typeof event.data.to === "string")
      toTeam([event.data.to], "ticket_assigned", `Te asignaron ${number}`, ticket.title);
  } else {
    switch (event.type) {
      case "created":
        toRequester("ticket_created", `Recibimos tu ticket ${number}`, ticket.title);
        toTeam(context.team, "new_ticket", `Nuevo ticket ${number}`, excerpt(`${context.requesterName}: ${ticket.title}`));
        break;
      case "status_changed": {
        const from = label(event.data.from);
        const to = label(event.data.to);
        const reason = closureReasonLabel[event.data.closure_reason as ClosureReason];
        const summary = typeof event.data.resolution_summary === "string" ? event.data.resolution_summary : "";
        const body = event.data.to === "closed" && reason ? excerpt(`Motivo: ${reason}.${summary ? ` ${summary}` : ""}`) : ticket.title;
        toRequester("status_changed", `${number} pasó de ${from} a ${to}`, body, { from, to });
        break;
      }
      case "comment_added": {
        const text = excerpt(context.commentBody ?? "");
        if (event.data.from_team === true) {
          if (event.data.requests_info === true)
            toRequester("info_requested", `El equipo necesita información en ${number}`, text, { excerpt: text });
          else toRequester("team_comment", `Nueva respuesta del equipo en ${number}`, text, { excerpt: text });
        } else {
          toTeam(context.team, "requester_replied", `${context.requesterName} respondió en ${number}`, text, { excerpt: text });
        }
        break;
      }
      case "reopened": {
        const reason = typeof event.data.reason === "string" ? excerpt(event.data.reason) : "";
        const extra = { from: label("closed"), to: label("open") };
        // Si lo reabrió el equipo, el resto del equipo se entera con un texto neutro.
        const teamTitle = event.data.by_team === true ? `${number} se reabrió` : `${context.requesterName} reabrió ${number}`;
        toRequester("ticket_reopened", `${number} se reabrió`, reason, extra);
        toTeam(context.team, "ticket_reopened", teamTitle, reason, extra);
        break;
      }
    }
  }

  // Nadie se notifica a sí mismo, salvo la confirmación de creación.
  const seen = new Set<string>();
  return out.filter((item) => {
    if (item.recipientId === event.actor_id && item.type !== "ticket_created") return false;
    // Un admin que es también el solicitante recibe una sola notificación por evento.
    if (seen.has(item.recipientId)) return false;
    seen.add(item.recipientId);
    return true;
  });
}
