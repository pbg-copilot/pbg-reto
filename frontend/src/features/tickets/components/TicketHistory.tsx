import { useState } from "react";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleHelpIcon,
  FileXIcon,
  FlagIcon,
  FolderIcon,
  LockIcon,
  MessageSquareIcon,
  PaperclipIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  SirenIcon,
  SparklesIcon,
  TagIcon,
  UserCheckIcon,
  UserMinusIcon,
  type LucideIcon,
} from "lucide-react";
import { closureReasonLabel, statusLabel, type ClosureReason, type TicketEvent, type TicketStatus } from "@reto/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./badges";

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
    case "attachment_added": {
      const names = (d.names as string[] | undefined) ?? [];
      const what = names.length === 1 ? `«${names[0]}»` : `${names.length} archivos`;
      return d.source === "chat" ? `Adjuntó ${what} desde el chat` : `Adjuntó ${what}`;
    }
    case "attachment_removed":
      return `Retiró «${str(d.name)}»: ${str(d.reason)}`;
    default:
      return event.type;
  }
}

type Tone = "brand" | "gold" | "success" | "neutral" | "danger";
const TONE: Record<Tone, string> = {
  brand: "bg-brand/10 text-primary ring-brand/25 dark:text-brand",
  gold: "bg-gold-soft text-gold-foreground ring-gold/30",
  success: "bg-success-soft text-success-foreground ring-success/30",
  neutral: "bg-muted text-muted-foreground ring-border",
  danger: "bg-destructive/10 text-destructive ring-destructive/25",
};

// Ícono y color por tipo de evento (Abierto = brand, En revisión = gold, Cerrado = success).
function eventStyle(event: TicketEvent): { icon: LucideIcon; tone: Tone } {
  const d = event.data;
  switch (event.type) {
    case "created":
      return { icon: SparklesIcon, tone: "brand" };
    case "status_changed":
      if (d.to === "closed") return { icon: CircleCheckIcon, tone: "success" };
      if (d.to === "in_review") return { icon: PlayIcon, tone: "gold" };
      return { icon: CircleDotIcon, tone: "brand" };
    case "reopened":
      return { icon: RotateCcwIcon, tone: "gold" };
    case "assigned":
      return { icon: d.to ? UserCheckIcon : UserMinusIcon, tone: "neutral" };
    case "priority_changed":
      return { icon: FlagIcon, tone: d.to === "urgent" ? "danger" : "neutral" };
    case "category_changed":
      return { icon: FolderIcon, tone: "neutral" };
    case "tags_changed":
      return { icon: TagIcon, tone: "neutral" };
    case "comment_added":
      if (event.visibility === "internal") return { icon: LockIcon, tone: "gold" };
      return { icon: d.requests_info ? CircleHelpIcon : MessageSquareIcon, tone: "brand" };
    case "comment_edited":
      return { icon: PencilIcon, tone: "neutral" };
    case "incident_linked":
    case "incident_unlinked":
      return { icon: SirenIcon, tone: "gold" };
    case "attachment_added":
      return { icon: PaperclipIcon, tone: "neutral" };
    case "attachment_removed":
      return { icon: FileXIcon, tone: "danger" };
    default:
      return { icon: CircleDotIcon, tone: "neutral" };
  }
}

const dayFormat = new Intl.DateTimeFormat("es", { day: "numeric", month: "long" });
const dayYearFormat = new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" });

function dayLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  return date.getFullYear() === now.getFullYear() ? dayFormat.format(date) : dayYearFormat.format(date);
}

const COLLAPSED = 6;

// Línea de tiempo del caso, de lo más nuevo a lo más antiguo, agrupada por día.
export function TicketHistory({ events, names }: { events: TicketEvent[]; names: Names }) {
  const [expanded, setExpanded] = useState(false);
  const ordered = [...events].reverse();
  const canCollapse = ordered.length > COLLAPSED + 2;
  const visible = canCollapse && !expanded ? ordered.slice(0, COLLAPSED) : ordered;

  const groups: { day: string; items: TicketEvent[] }[] = [];
  for (const event of visible) {
    const day = dayLabel(event.created_at);
    const last = groups.at(-1);
    if (last?.day === day) last.items.push(event);
    else groups.push({ day, items: [event] });
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.day} aria-label={group.day} className="flex flex-col gap-3">
          <h3 className="eyebrow">{group.day}</h3>
          <ol className="flex flex-col">
            {group.items.map((event, index) => (
              <TimelineItem key={event.id} event={event} names={names} last={index === group.items.length - 1} />
            ))}
          </ol>
        </section>
      ))}
      {canCollapse && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? <ChevronUpIcon data-icon="inline-start" aria-hidden="true" /> : <ChevronDownIcon data-icon="inline-start" aria-hidden="true" />}
          {expanded ? "Ver menos" : `Ver todo el historial (${ordered.length})`}
        </Button>
      )}
    </div>
  );
}

function TimelineItem({ event, names, last }: { event: TicketEvent; names: Names; last: boolean }) {
  const { icon: Icon, tone } = eventStyle(event);
  const d = event.data;
  const statusChange = event.type === "status_changed";
  // "Ana reabrió el ticket": la descripción continúa la frase que empieza con el nombre.
  const text = describeEvent(event, names);
  const sentence = text.charAt(0).toLowerCase() + text.slice(1);
  const quote = statusChange && typeof d.resolution_summary === "string" ? d.resolution_summary : null;
  const reason = statusChange && d.to === "closed" ? closureReasonLabel[d.closure_reason as ClosureReason] : undefined;

  return (
    <li className="relative flex gap-3 pb-4 text-sm last:pb-0">
      {/* Línea que une los eventos del mismo día. */}
      {!last && <span aria-hidden="true" className="absolute top-8 bottom-0 left-[15px] w-px bg-border" />}
      <span aria-hidden="true" className={cn("relative flex size-8 shrink-0 items-center justify-center rounded-full ring-1", TONE[tone])}>
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-1">
        <p className="leading-snug">
          <strong className="font-semibold">{event.actor?.name ?? "Sistema"}</strong>{" "}
          {statusChange ? (
            <>
              {/* Los chips muestran "de → a"; el lector de pantalla recibe la frase completa. */}
              <span aria-hidden="true" className="text-foreground/90">
                cambió el estado{reason ? ` · ${reason}` : ""}
              </span>
              <span className="sr-only">{sentence}</span>
            </>
          ) : (
            <span className="text-foreground/90">{sentence}</span>
          )}
        </p>
        {statusChange && (
          <span className="flex flex-wrap items-center gap-1.5" aria-hidden="true">
            <StatusBadge status={d.from as TicketStatus} />
            <ArrowRightIcon className="size-3.5 text-muted-foreground" />
            <StatusBadge status={d.to as TicketStatus} />
          </span>
        )}
        {quote && <blockquote className="border-l-2 border-success/40 pl-3 text-muted-foreground">{quote}</blockquote>}
        <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <time dateTime={event.created_at} title={formatDateTime(event.created_at)}>
            {timeFormat.format(new Date(event.created_at))} · {formatRelative(event.created_at)}
          </time>
          {event.visibility === "internal" && (
            <Badge variant="outline" className="h-4 border-gold/40 px-1.5 text-[10px] text-gold-foreground">
              Solo equipo
            </Badge>
          )}
        </span>
      </div>
    </li>
  );
}
