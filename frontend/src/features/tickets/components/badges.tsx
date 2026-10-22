import { SignalHighIcon, SignalLowIcon, SignalMediumIcon, SirenIcon, type LucideIcon } from "lucide-react";
import { statusLabel, type TicketStatus } from "@reto/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Colores de estado (CLAUDE.md §Diseño): Abierto = brand, En revisión = gold, Cerrado = success.
const statusStyles: Record<TicketStatus, string> = {
  open: "border-brand/30 bg-brand/10 text-primary dark:text-brand",
  in_review: "border-gold/30 bg-gold-soft text-gold-foreground",
  closed: "border-success/30 bg-success-soft text-success-foreground",
};

export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn(statusStyles[status], className)}>
      {statusLabel[status]}
    </Badge>
  );
}

// Escala de criticidad = prioridad (4 niveles). Cada nivel tiene color, ícono y texto: nunca
// solo color. Baja neutra, Media en el tono primario, Alta en dorado y Urgente en rojo.
type PriorityLevel = { className: string; dot: string; icon: LucideIcon };
const PRIORITY_LEVELS: Record<string, PriorityLevel> = {
  low: { className: "border-border bg-muted/60 text-muted-foreground", dot: "bg-muted-foreground", icon: SignalLowIcon },
  medium: { className: "border-primary/30 text-primary dark:border-brand/40 dark:text-brand", dot: "bg-primary dark:bg-brand", icon: SignalMediumIcon },
  high: { className: "border-gold/50 bg-gold-soft text-gold-foreground", dot: "bg-gold", icon: SignalHighIcon },
  urgent: { className: "border-destructive/50 bg-destructive/10 font-semibold text-destructive", dot: "bg-destructive", icon: SirenIcon },
};
const FALLBACK_LEVEL: PriorityLevel = { className: "", dot: "bg-muted-foreground", icon: SignalMediumIcon };
export const priorityLevel = (code: string) => PRIORITY_LEVELS[code] ?? FALLBACK_LEVEL;

export function PriorityBadge({ code, name, className }: { code: string; name: string; className?: string }) {
  const level = priorityLevel(code);
  const Icon = level.icon;
  return (
    <Badge variant="outline" className={cn("gap-1", level.className, className)} data-priority={code}>
      <Icon aria-hidden="true" />
      <span>
        <span className="sr-only">Prioridad </span>
        {name}
      </span>
    </Badge>
  );
}

// Para listas de opciones (Select): punto de color + ícono + nombre.
export function PriorityOption({ code, name }: { code: string; name: string }) {
  const level = priorityLevel(code);
  const Icon = level.icon;
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className={cn("size-2 rounded-full", level.dot)} />
      <Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
      {name}
    </span>
  );
}
