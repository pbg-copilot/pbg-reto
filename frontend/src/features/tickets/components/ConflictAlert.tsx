import { statusLabel, type TicketDetail } from "@reto/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// Conflicto de versión (409): otro admin guardó antes. Lo que escribiste se conserva;
// puedes aplicarlo sobre la versión nueva o descartarlo.
export function ConflictAlert({
  current,
  onRetry,
  onDiscard,
  pending,
}: {
  current: TicketDetail;
  onRetry: () => void;
  onDiscard: () => void;
  pending?: boolean;
}) {
  return (
    <Alert role="alert" className="border-gold/50 bg-gold-soft">
      <AlertTitle>Otro administrador actualizó este ticket</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>
          Ahora está en <strong>{statusLabel[current.status]}</strong>
          {current.assignee ? ` y asignado a ${current.assignee.name}` : ""}. Tu cambio no se guardó.
        </span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onRetry} disabled={pending}>
            Aplicar mi cambio sobre la versión nueva
          </Button>
          <Button size="sm" variant="outline" onClick={onDiscard} disabled={pending}>
            Descartar mi cambio
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  );
}
