import { Link } from "react-router";
import { CheckIcon, MessageSquarePlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { assistantActionLabel, type AssistantAction } from "@reto/shared";
import { toast } from "@/components/feedback/toast-store";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useActionDecision } from "../api";

const STATUS: Record<AssistantAction["status"], { label: string; className: string }> = {
  proposed: { label: "Esperando tu confirmación", className: "border-gold/40 bg-gold-soft text-gold-foreground" },
  confirmed: { label: "Confirmada", className: "border-success/30 bg-success-soft text-success-foreground" },
  cancelled: { label: "Cancelada", className: "text-muted-foreground" },
  expired: { label: "Venció", className: "text-muted-foreground" },
  failed: { label: "No se pudo aplicar", className: "border-destructive/40 text-destructive" },
};

// Propuesta del asistente (009 C). El asistente no ejecuta nada: solo este botón lo hace, con
// la sesión de la persona y las reglas normales del ticket.
export function ActionCard({ action, conversationId, readOnly }: { action: AssistantAction; conversationId: string; readOnly: boolean }) {
  const decision = useActionDecision(conversationId);
  const Icon = action.type === "comment_on_ticket" ? MessageSquarePlusIcon : RotateCcwIcon;
  const open = action.status === "proposed" && !readOnly;
  const pending = decision.isPending && decision.variables?.actionId === action.id;

  function decide(kind: "confirm" | "cancel") {
    decision.mutate(
      { actionId: action.id, kind },
      {
        onSuccess: (updated) => {
          if (kind === "cancel") return toast.info("Propuesta cancelada");
          toast.success(
            updated.type === "comment_on_ticket" ? `Comentario agregado a ${updated.ticket.display_number}` : `${updated.ticket.display_number} reabierto`,
            { description: "El equipo de soporte recibe el aviso." },
          );
        },
      },
    );
  }

  return (
    <div className={cn("glass flex flex-col gap-3 rounded-xl border p-4 text-sm", open && "border-gold/50")} data-testid="action-card">
      <div className="flex flex-wrap items-center gap-2">
        <Icon aria-hidden="true" className="size-4 text-brand" />
        <span className="font-semibold">
          {assistantActionLabel[action.type]} ·{" "}
          <Link to={action.ticket.url} className="underline">
            {action.ticket.display_number}
          </Link>
        </span>
        <Badge variant="outline" className={cn("ml-auto", STATUS[action.status].className)}>
          {STATUS[action.status].label}
        </Badge>
      </div>
      <blockquote className="border-l-2 border-brand/40 pl-3 whitespace-pre-wrap text-foreground/90">{action.text}</blockquote>
      {action.error && <p className="text-xs text-destructive">{action.error}</p>}
      {decision.error && decision.variables?.actionId === action.id && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{decision.error.message}</AlertDescription>
        </Alert>
      )}
      {open ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => decide("confirm")}>
            {pending && decision.variables?.kind === "confirm" ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <CheckIcon data-icon="inline-start" aria-hidden="true" />}
            Confirmar
          </Button>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("cancel")}>
            <XIcon data-icon="inline-start" aria-hidden="true" />
            Cancelar
          </Button>
          <span className="text-xs text-muted-foreground">Vence {formatDateTime(action.expires_at)}. No se hace nada hasta que confirmes.</span>
        </div>
      ) : (
        action.decided_at && <span className="text-xs text-muted-foreground">{formatDateTime(action.decided_at)}</span>
      )}
    </div>
  );
}
