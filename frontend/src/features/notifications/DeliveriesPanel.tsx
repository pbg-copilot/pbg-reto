import { RotateCcwIcon } from "lucide-react";
import {
  deliveryChannelLabel,
  deliveryStatusLabel,
  notificationTypeLabel,
  type Delivery,
  type DeliveryStatus,
} from "@reto/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useDeliveries, useRetryDelivery } from "./api";

const STATUS_VARIANT: Record<DeliveryStatus, "secondary" | "outline" | "destructive"> = {
  delivered: "secondary",
  pending: "outline",
  failed: "destructive",
};

// Solo admin (AC-005.10): a quién se avisó, por qué canal y si llegó.
export function DeliveriesPanel({ ticketId }: { ticketId: string }) {
  const deliveries = useDeliveries(ticketId, true);
  const retry = useRetryDelivery(ticketId);

  if (deliveries.isPending) return <Skeleton className="h-20 w-full" />;
  if (deliveries.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{deliveries.error.message}</AlertDescription>
      </Alert>
    );
  if (deliveries.data.length === 0) return <p className="text-sm text-muted-foreground">Todavía no hay avisos de este ticket.</p>;

  return (
    <ul className="flex flex-col gap-3" aria-label="Entregas de notificaciones">
      {deliveries.data.map((delivery) => (
        <DeliveryItem
          key={delivery.id}
          delivery={delivery}
          retrying={retry.isPending && retry.variables === delivery.id}
          onRetry={() => retry.mutate(delivery.id)}
        />
      ))}
      {retry.error && (
        <li>
          <Alert variant="destructive" role="alert">
            <AlertDescription>{retry.error.message}</AlertDescription>
          </Alert>
        </li>
      )}
    </ul>
  );
}

function DeliveryItem({ delivery, retrying, onRetry }: { delivery: Delivery; retrying: boolean; onRetry: () => void }) {
  return (
    <li className="flex flex-col gap-1 text-sm" data-testid="delivery">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium">{delivery.recipient.name}</span>
        <Badge variant="outline">{deliveryChannelLabel[delivery.channel]}</Badge>
        <Badge variant={STATUS_VARIANT[delivery.status]}>{deliveryStatusLabel[delivery.status]}</Badge>
      </div>
      <span className="text-muted-foreground">
        {notificationTypeLabel[delivery.notification_type]} ·{" "}
        <time dateTime={delivery.created_at} title={formatDateTime(delivery.created_at)}>
          {formatRelative(delivery.created_at)}
        </time>
      </span>
      {delivery.status !== "delivered" && (
        <span className="text-xs text-muted-foreground">
          Intentos: {delivery.attempts}
          {delivery.last_error ? ` · Último error: ${delivery.last_error}` : ""}
        </span>
      )}
      {delivery.status === "failed" && delivery.channel === "email" && (
        <Button size="sm" variant="outline" className="self-start" disabled={retrying} onClick={onRetry}>
          <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
          {retrying ? "Reintentando…" : "Reintentar entrega"}
        </Button>
      )}
    </li>
  );
}
