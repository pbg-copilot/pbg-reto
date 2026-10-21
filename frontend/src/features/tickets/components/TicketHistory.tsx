import { closureReasonLabel, statusLabel, type ClosureReason, type TicketEvent, type TicketStatus } from "@reto/shared";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

type Names = { categoryName: (code: string) => string; priorityName: (code: string) => string };

const SOURCE_LABEL: Record<string, string> = {
  manual_form: "desde el formulario",
  assistant: "desde el asistente",
  human_request: "al pedir ayuda humana",
};

const str = (value: unknown) => (typeof value === "string" ? value : "");

export function describeEvent(event: TicketEvent, names: Names): string {
  const d = event.data;
  switch (event.type) {
    case "created":
      return `Creó el ticket ${SOURCE_LABEL[str(d.source)] ?? ""}`.trim();
    case "status_changed": {
      const base = `Cambió el estado de ${statusLabel[d.from as TicketStatus]} a ${statusLabel[d.to as TicketStatus]}`;
      if (d.to !== "closed") return base;
      const reason = closureReasonLabel[d.closure_reason as ClosureReason];
      return `${base} · ${reason}${d.duplicate_of_number ? ` de TCK-${String(d.duplicate_of_number).padStart(6, "0")}` : ""}`;
    }
    case "reopened":
      return `Reabrió el ticket: «${str(d.reason)}»`;
    case "assigned":
      return d.to ? `Asignó el caso a ${str(d.to_name) || "un administrador"}` : "Quitó el responsable";
    case "priority_changed":
      return `Cambió la prioridad de ${names.priorityName(str(d.from))} a ${names.priorityName(str(d.to))}`;
    case "category_changed":
      return `Cambió la categoría de ${names.categoryName(str(d.from))} a ${names.categoryName(str(d.to))}`;
    case "tags_changed":
      return `Actualizó las etiquetas: ${(d.to as string[] | undefined)?.join(", ") || "sin etiquetas"}`;
    case "comment_added":
      if (event.visibility === "internal") return "Dejó una nota interna";
      return d.requests_info ? "Pidió información al solicitante" : "Comentó";
    case "comment_edited":
      return "Corrigió un comentario";
    case "incident_linked":
      return `Vinculó el caso al incidente «${str(d.title)}»`;
    case "incident_unlinked":
      return "Desvinculó el caso del incidente";
    default:
      return event.type;
  }
}

export function TicketHistory({ events, names }: { events: TicketEvent[]; names: Names }) {
  return (
    <ol className="flex flex-col gap-4">
      {[...events].reverse().map((event) => (
        <li key={event.id} className="relative flex gap-3 text-sm">
          <span
            aria-hidden="true"
            className={cn("mt-1.5 size-2 shrink-0 rounded-full", event.visibility === "internal" ? "bg-gold" : "bg-brand")}
          />
          <div className="flex min-w-0 flex-col">
            <span>
              <strong className="font-medium">{event.actor?.name ?? "Sistema"}</strong> · {describeEvent(event, names)}
            </span>
            {event.type === "status_changed" && typeof event.data.resolution_summary === "string" && (
              <span className="text-muted-foreground">{event.data.resolution_summary}</span>
            )}
            <time dateTime={event.created_at} title={formatDateTime(event.created_at)} className="text-xs text-muted-foreground">
              {formatRelative(event.created_at)}
              {event.visibility === "internal" && " · solo equipo"}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
