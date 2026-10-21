import { statusLabel, type ClosureReason, type TicketStatus } from "@reto/shared";

// Reglas de transición (specs/000-overview/domain.md). Funciones puras: sin base de datos.

export type TransitionInput = {
  closure_reason?: ClosureReason;
  resolution_summary?: string;
  duplicate_of_ticket_id?: string | null;
};

export type TransitionChanges = {
  status: TicketStatus;
  closure_reason: ClosureReason | null;
  resolution_summary: string | null;
  duplicate_of_ticket_id: string | null;
};

export type TransitionError = {
  kind: "error";
  code: "invalid_transition" | "resolution_required";
  message: string;
};

export type TransitionResult = { kind: "noop" } | { kind: "ok"; changes: TransitionChanges } | TransitionError;

const ALLOWED: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_review", "closed"],
  in_review: ["closed"],
  closed: [],
};

const invalid = (message: string): TransitionError => ({ kind: "error", code: "invalid_transition", message });
const missing = (message: string): TransitionError => ({ kind: "error", code: "resolution_required", message });

export function transition(from: TicketStatus, to: TicketStatus, input: TransitionInput = {}): TransitionResult {
  // Un clic repetido con el mismo estado no es una transición nueva.
  if (from === to) return { kind: "noop" };
  if (from === "closed")
    return invalid("Este ticket está cerrado. Para retomarlo hay que reabrirlo.");
  if (!ALLOWED[from].includes(to))
    return invalid(`No se puede pasar de ${statusLabel[from]} a ${statusLabel[to]}.`);

  if (to !== "closed")
    return {
      kind: "ok",
      changes: { status: to, closure_reason: null, resolution_summary: null, duplicate_of_ticket_id: null },
    };

  const reason = input.closure_reason;
  const summary = input.resolution_summary?.trim() || null;
  if (!reason) return missing("Indica el motivo del cierre.");
  if (reason === "duplicate") {
    if (!input.duplicate_of_ticket_id) return missing("Indica el ticket original del que este es un duplicado.");
  } else if (!summary) {
    return missing(reason === "resolved" ? "Escribe el resumen de la resolución." : "Describe el motivo del cierre.");
  }
  return {
    kind: "ok",
    changes: {
      status: "closed",
      closure_reason: reason,
      resolution_summary: summary,
      duplicate_of_ticket_id: reason === "duplicate" ? (input.duplicate_of_ticket_id ?? null) : null,
    },
  };
}

// Reabrir: solo desde Cerrado, vuelve a Abierto y conserva el historial.
export function reopen(from: TicketStatus): { kind: "ok"; changes: TransitionChanges } | TransitionError {
  if (from !== "closed") return invalid("Solo se puede reabrir un ticket cerrado.");
  return {
    kind: "ok",
    changes: { status: "open", closure_reason: null, resolution_summary: null, duplicate_of_ticket_id: null },
  };
}
