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

const priorityStyles: Record<string, string> = {
  low: "text-muted-foreground",
  medium: "",
  high: "border-gold/40 text-gold-foreground",
  urgent: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function PriorityBadge({ code, name }: { code: string; name: string }) {
  return (
    <Badge variant="outline" className={priorityStyles[code]}>
      {name}
    </Badge>
  );
}
