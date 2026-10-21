import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CircleAlertIcon, HourglassIcon, MailWarningIcon, MessageCircleReplyIcon, SirenIcon, UserRoundXIcon } from "lucide-react";
import type { AttentionItem, Operations } from "@reto/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useOperations } from "./api";

// "Ahora mismo": lo que el equipo debería atender ya. En vivo, independiente del rango.
export function OperationsSection() {
  const operations = useOperations();
  const ops = operations.data;

  return (
    <section aria-labelledby="now-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="now-heading" className="text-xl font-semibold tracking-tight">
          Ahora mismo
        </h2>
        <span className="text-xs text-muted-foreground">En vivo · se actualiza cada minuto</span>
      </div>
      {operations.isError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{operations.error.message}</AlertDescription>
        </Alert>
      )}
      {!ops ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-56" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3" data-testid="attention">
            <AttentionCard
              icon={<CircleAlertIcon />}
              title="Sin atender"
              description="Abiertos sin respuesta pública del equipo"
              list={ops.unattended}
              sinceLabel="creado"
              tone="danger"
              filterUrl="/tickets?unattended=true"
            />
            <AttentionCard
              icon={<MessageCircleReplyIcon />}
              title="Esperan al equipo"
              description="El solicitante respondió y nadie le contestó todavía"
              list={ops.waiting_team}
              sinceLabel="respondió"
              tone="warning"
              filterUrl="/tickets?waiting=team"
            />
            <AttentionCard
              icon={<HourglassIcon />}
              title="Esperan al solicitante"
              description="Se pidió información y no ha respondido"
              list={ops.waiting_requester}
              sinceLabel="se pidió"
              filterUrl="/tickets?waiting=requester"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <AgingCard aging={ops.aging} />
            <WorkloadCard workload={ops.workload} unassigned={ops.unassigned} />
            <HealthCard health={ops.health} />
          </div>
        </>
      )}
    </section>
  );
}

function AttentionCard({
  icon,
  title,
  description,
  list,
  sinceLabel,
  tone,
  filterUrl,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  list: { count: number; items: AttentionItem[] };
  sinceLabel: string;
  tone?: "danger" | "warning";
  filterUrl?: string;
}) {
  const busy = list.count > 0;
  return (
    <Card className={cn("glass", busy && tone === "danger" && "border-destructive/40", busy && tone === "warning" && "border-gold/50")}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base [&_svg]:size-4 [&_svg]:text-brand">
          <span className="flex items-center gap-2">
            {icon}
            {title}
          </span>
          <span className={cn("text-2xl font-bold", busy && tone === "danger" && "text-destructive", busy && tone === "warning" && "text-gold-foreground")}>
            {list.count}
          </span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {list.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada pendiente.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {list.items.map((item) => (
              <li key={item.id} className="py-2 text-sm first:pt-0">
                <Link to={`/tickets/${item.id}`} className="flex flex-col gap-0.5 hover:underline">
                  <span className="truncate font-medium">
                    <span className="font-mono text-xs text-muted-foreground">{item.display_number}</span> {item.title}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.priority} · {sinceLabel}{" "}
                    <time dateTime={item.since} title={formatDateTime(item.since)}>
                      {formatRelative(item.since)}
                    </time>{" "}
                    · {item.assignee ?? "sin responsable"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {/* Con muchos tickets la tarjeta muestra los 5 más antiguos; el resto, en la bandeja paginada. */}
        {filterUrl && list.count > 0 && (
          <Link to={filterUrl} className="text-sm font-medium text-primary hover:underline dark:text-brand">
            {list.count > list.items.length ? `Ver los ${list.count} en la bandeja` : "Abrir en la bandeja"}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function AgingCard({ aging }: { aging: Operations["aging"] }) {
  const rows = [
    { label: "Menos de 24 h", value: aging.under_24h, className: "bg-brand" },
    { label: "1 a 3 días", value: aging.d1_3, className: "bg-brand/70" },
    { label: "3 a 7 días", value: aging.d3_7, className: "bg-gold" },
    { label: "Más de 7 días", value: aging.over_7d, className: "bg-destructive" },
  ];
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">Antigüedad de lo pendiente</CardTitle>
        <CardDescription>Tickets abiertos o en revisión, por tiempo desde que se crearon</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.label} className="flex flex-col gap-1 text-sm">
              <span className="flex justify-between">
                <span>{row.label}</span>
                <span className="font-medium">{row.value}</span>
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span className={cn("block h-full rounded-full", row.className)} style={{ width: `${(row.value / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const WORKLOAD_VISIBLE = 6;

function WorkloadCard({ workload, unassigned }: { workload: Operations["workload"]; unassigned: number }) {
  // Con muchos admins se muestran los de más carga (vienen ordenados) y el resto a pedido.
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? workload : workload.slice(0, WORKLOAD_VISIBLE);
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">Carga del equipo</CardTitle>
        <CardDescription>Tickets no cerrados por responsable</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Link
          to="/tickets?assignee=unassigned"
          className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-accent", unassigned > 0 && "border-gold/50")}
        >
          <span className="flex items-center gap-2">
            <UserRoundXIcon aria-hidden="true" className="size-4 text-gold-foreground" />
            Sin responsable
          </span>
          <span className="font-semibold">{unassigned}</span>
        </Link>
        <ul className="flex flex-col gap-2 text-sm">
          {visible.map((admin) => (
            <li key={admin.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{admin.name}</span>
              <span className="flex shrink-0 gap-1">
                <Badge variant="outline" className="border-brand/30 text-primary dark:text-brand">
                  {admin.open} abiertos
                </Badge>
                <Badge variant="outline" className="border-gold/40 text-gold-foreground">
                  {admin.in_review} en revisión
                </Badge>
              </span>
            </li>
          ))}
        </ul>
        {workload.length > WORKLOAD_VISIBLE && (
          <Button variant="ghost" size="sm" className="self-start" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Ver menos" : `Ver los ${workload.length} administradores`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function HealthCard({ health }: { health: Operations["health"] }) {
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">Salud del servicio</CardTitle>
        <CardDescription>Avisos que no llegaron e incidentes abiertos</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <HealthRow
          icon={<MailWarningIcon />}
          label="Correos fallidos (7 días)"
          value={health.failed_deliveries_7d}
          alert={health.failed_deliveries_7d > 0}
          hint="Se reintentan desde el panel «Entregas» del ticket"
        />
        <HealthRow icon={<MailWarningIcon />} label="Correos pendientes" value={health.pending_deliveries} hint="El worker los reintenta con backoff" />
        <Link to="/admin/incidentes" className="hover:underline">
          <HealthRow
            icon={<SirenIcon />}
            label="Incidentes activos"
            value={health.active_incidents}
            alert={health.active_incidents > 0}
            hint={`${health.tickets_in_active_incidents} tickets abiertos vinculados`}
          />
        </Link>
      </CardContent>
    </Card>
  );
}

function HealthRow({ icon, label, value, hint, alert }: { icon: ReactNode; label: string; value: number; hint: string; alert?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="flex items-start gap-2 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-brand">
        {icon}
        <span className="flex flex-col">
          <span>{label}</span>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </span>
      </span>
      <span className={cn("text-lg font-semibold", alert && "text-destructive")}>{value}</span>
    </div>
  );
}
