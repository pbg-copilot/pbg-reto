import { useState } from "react";
import { BellIcon, ChevronDownIcon, ChevronUpIcon, MailIcon, RotateCcwIcon } from "lucide-react";
import {
  deliveryChannelLabel,
  deliveryStatusLabel,
  notificationTypeLabel,
  type Delivery,
  type DeliveryStatus,
} from "@reto/shared";
import { toast } from "@/components/feedback/toast-store";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDeliveries, useRetryDelivery } from "./api";

const STATUS_STYLE: Record<DeliveryStatus, string> = {
  delivered: "border-success/30 bg-success-soft text-success-foreground",
  pending: "border-gold/30 bg-gold-soft text-gold-foreground",
  failed: "border-destructive/40 bg-destructive/10 text-destructive",
};
const COLLAPSED = 5;

type Group = { notificationId: string; first: Delivery; channels: Delivery[] };

// Una fila por aviso (destinatario + tipo) con el estado de cada canal (AC-005.10).
function groupByNotification(deliveries: Delivery[]): Group[] {
  const groups = new Map<string, Group>();
  for (const delivery of deliveries) {
    const group = groups.get(delivery.notification_id);
    if (group) group.channels.push(delivery);
    else groups.set(delivery.notification_id, { notificationId: delivery.notification_id, first: delivery, channels: [delivery] });
  }
  for (const group of groups.values()) group.channels.sort((a, b) => a.channel.localeCompare(b.channel));
  return [...groups.values()];
}

// Solo admin: a quién se avisó, por qué canal y si llegó.
export function DeliveriesPanel({ ticketId }: { ticketId: string }) {
  const deliveries = useDeliveries(ticketId, true);
  const retry = useRetryDelivery(ticketId);
  const [expanded, setExpanded] = useState(false);

  if (deliveries.isPending) return <Skeleton className="h-20 w-full" />;
  if (deliveries.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{deliveries.error.message}</AlertDescription>
      </Alert>
    );
  if (deliveries.data.length === 0) return <p className="text-sm text-muted-foreground">Todavía no hay avisos de este ticket.</p>;

  const groups = groupByNotification(deliveries.data);
  const visible = expanded ? groups : groups.slice(0, COLLAPSED);
  const failed = deliveries.data.filter((d) => d.status === "failed").length;
  const pending = deliveries.data.filter((d) => d.status === "pending").length;

  return (
    <div className="flex flex-col gap-3">
      {(failed > 0 || pending > 0) && (
        <p className="text-sm text-muted-foreground">
          {failed > 0 && <span className="font-medium text-destructive">{failed} fallida{failed > 1 ? "s" : ""}</span>}
          {failed > 0 && pending > 0 && " · "}
          {pending > 0 && <span>{pending} pendiente{pending > 1 ? "s" : ""}</span>}
        </p>
      )}
      <ul className="flex flex-col divide-y" aria-label="Entregas de notificaciones">
        {visible.map((group) => (
          <li key={group.notificationId} className="flex flex-col gap-1.5 py-2.5 text-sm first:pt-0 last:pb-0" data-testid="delivery">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{group.first.recipient.name}</span>
              <time
                dateTime={group.first.created_at}
                title={formatDateTime(group.first.created_at)}
                className="shrink-0 text-xs text-muted-foreground"
              >
                {formatRelative(group.first.created_at)}
              </time>
            </div>
            <span className="text-muted-foreground">{notificationTypeLabel[group.first.notification_type]}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {group.channels.map((delivery) => (
                <ChannelBadge key={delivery.id} delivery={delivery} />
              ))}
            </div>
            {group.channels
              .filter((delivery) => delivery.status !== "delivered")
              .map((delivery) => (
                <div key={delivery.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {deliveryChannelLabel[delivery.channel]}: {delivery.attempts} intento{delivery.attempts === 1 ? "" : "s"}
                    {delivery.last_error ? ` · ${delivery.last_error}` : ""}
                  </span>
                  {delivery.status === "failed" && delivery.channel === "email" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retry.isPending && retry.variables === delivery.id}
                      onClick={() =>
                        retry.mutate(delivery.id, {
                          onSuccess: () => toast.info("Correo en cola otra vez", { description: "El worker lo reintenta en segundos." }),
                        })
                      }
                    >
                      <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                      Reintentar entrega
                    </Button>
                  )}
                </div>
              ))}
          </li>
        ))}
      </ul>
      {retry.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{retry.error.message}</AlertDescription>
        </Alert>
      )}
      {groups.length > COLLAPSED && (
        <Button variant="ghost" size="sm" className="self-start" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
          {expanded ? <ChevronUpIcon data-icon="inline-start" aria-hidden="true" /> : <ChevronDownIcon data-icon="inline-start" aria-hidden="true" />}
          {expanded ? "Ver menos" : `Ver todos los avisos (${groups.length})`}
        </Button>
      )}
    </div>
  );
}

function ChannelBadge({ delivery }: { delivery: Delivery }) {
  const Icon = delivery.channel === "email" ? MailIcon : BellIcon;
  return (
    <Badge variant="outline" className={cn("gap-1", STATUS_STYLE[delivery.status])}>
      <Icon aria-hidden="true" />
      {deliveryChannelLabel[delivery.channel]} · {deliveryStatusLabel[delivery.status]}
    </Badge>
  );
}
