import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { BotIcon, CircleAlertIcon, ClockIcon, HelpCircleIcon, InboxIcon, RotateCcwIcon, SettingsIcon, TimerIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { formatDuration, formatMinutesTarget, useMetrics } from "./api";

const RANGES = [
  { value: "7", label: "7 días" },
  { value: "30", label: "30 días" },
  { value: "90", label: "90 días" },
];
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

function rangeFor(days: number) {
  const to = new Date(Date.now() + 86_400_000);
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: isoDay(from), to: isoDay(to) };
}

const usd = (value: number) => `US$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`;

// Vista de seguimiento del equipo (spec 007). Las fórmulas están a la vista en "¿Cómo se calcula?".
export function MetricsPage() {
  const [days, setDays] = useState("30");
  const range = rangeFor(Number(days));
  const metrics = useMetrics(range.from, range.to);

  useEffect(() => {
    document.title = "RETO · Métricas";
  }, []);

  const m = metrics.data;
  const maxCategory = Math.max(1, ...(m?.by_category.map((c) => c.count) ?? [1]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-primary">Seguimiento</span>
          <h1 className="text-3xl font-bold tracking-tight">Métricas de atención</h1>
          <p className="text-muted-foreground">Tickets creados en el rango elegido. Tiempos en calendario (UTC).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {metrics.isPlaceholderData && <Spinner aria-label="Actualizando" />}
          <ToggleGroup type="single" variant="outline" value={days} onValueChange={(value) => value && setDays(value)} aria-label="Rango">
            {RANGES.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button variant="outline" asChild>
            <Link to="/admin/prioridades">
              <SettingsIcon data-icon="inline-start" aria-hidden="true" />
              Prioridades y objetivos
            </Link>
          </Button>
        </div>
      </div>

      {metrics.isError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{metrics.error.message}</AlertDescription>
        </Alert>
      )}

      {!m ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="kpis">
            <Kpi icon={<InboxIcon />} label="Abiertos" value={m.by_status.open} hint={`${m.total} tickets en el rango`} />
            <Kpi icon={<ClockIcon />} label="En revisión" value={m.by_status.in_review} hint={`${m.by_status.closed} cerrados`} />
            <Kpi
              icon={<CircleAlertIcon />}
              label="Sin atender"
              value={m.unattended}
              hint="Abiertos sin respuesta pública del equipo"
              tone={m.unattended > 0 ? "warning" : undefined}
            />
            <Kpi icon={<RotateCcwIcon />} label="Tasa de reapertura" value={m.reopen_rate === null ? "—" : `${m.reopen_rate}%`} hint={`${m.reopened} reabiertos`} />
            <Kpi
              icon={<TimerIcon />}
              label="Primera respuesta · mediana"
              value={formatDuration(m.first_response.p50)}
              hint={`p90 ${formatDuration(m.first_response.p90)} · ${m.first_response.count} con respuesta`}
            />
            <Kpi
              icon={<TimerIcon />}
              label="Resolución · mediana"
              value={formatDuration(m.resolution.p50)}
              hint={`p90 ${formatDuration(m.resolution.p90)} · ${m.resolution.count} resueltos`}
            />
            <Kpi
              icon={<BotIcon />}
              label="Costo de IA"
              value={usd(m.ai.assistant_cost_usd + m.ai.copilot_cost_usd)}
              hint={`Chat ${usd(m.ai.assistant_cost_usd)} · copiloto ${usd(m.ai.copilot_cost_usd)}`}
            />
            <Kpi
              icon={<BotIcon />}
              label="Costo por conversación"
              value={m.ai.cost_per_conversation_usd === null ? "—" : usd(m.ai.cost_per_conversation_usd)}
              hint={`${m.ai.conversations} conversaciones con el asistente`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base">Por prioridad</CardTitle>
                <CardDescription>El cumplimiento solo se calcula si la prioridad tiene un objetivo configurado.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Prioridad</TableHead>
                      <TableHead className="text-right">Tickets</TableHead>
                      <TableHead>Primera respuesta</TableHead>
                      <TableHead>Resolución</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {m.by_priority.map((row) => (
                      <TableRow key={row.code}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell className="text-right">{row.count}</TableCell>
                        <TableCell>
                          <Compliance target={formatMinutesTarget(row.first_response_target_minutes)} value={row.first_response_compliance} />
                        </TableCell>
                        <TableCell>
                          <Compliance target={formatMinutesTarget(row.resolution_target_minutes)} value={row.resolution_compliance} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base">Por categoría</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3">
                  {m.by_category.map((row) => (
                    <li key={row.code} className="flex flex-col gap-1 text-sm">
                      <span className="flex justify-between gap-2">
                        <span>{row.name}</span>
                        <span className="text-muted-foreground">{row.count}</span>
                      </span>
                      <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${(row.count / maxCategory) * 100}%` }} />
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          <details className="glass rounded-xl p-4 text-sm">
            <summary className="flex cursor-pointer items-center gap-2 font-medium">
              <HelpCircleIcon aria-hidden="true" className="size-4 text-brand" />
              ¿Cómo se calcula?
            </summary>
            <dl className="mt-4 grid gap-3 text-muted-foreground md:grid-cols-2">
              <Formula term="Rango">Tickets creados entre las fechas elegidas, en tiempo calendario (sin horario laboral), en UTC.</Formula>
              <Formula term="Primera respuesta (TPR)">
                Primer comentario <strong>público</strong> de un admin − creación. Las notas internas, la asignación y los cambios de estado no cuentan. No se recalcula al reabrir.
              </Formula>
              <Formula term="Resolución (TR)">Último cierre como «Resuelto» − creación. Reabrir alarga el TR. Los cierres por otros motivos no cuentan.</Formula>
              <Formula term="Sin atender">Tickets abiertos que todavía no tienen respuesta pública del equipo.</Formula>
              <Formula term="Tasa de reapertura">Tickets reabiertos al menos una vez / tickets resueltos.</Formula>
              <Formula term="Cumplimiento">% de tickets con TPR (o TR) dentro del objetivo de su prioridad. Sin objetivo: «Sin objetivo definido». Nunca se muestran plazos al solicitante.</Formula>
              <Formula term="Mediana y p90">La mediana es el valor del medio; el p90 deja al 90 % de los tickets por debajo. Son más robustos que el promedio ante casos extremos.</Formula>
              <Formula term="Costo de IA">Tokens guardados de cada respuesta del asistente y de cada uso del copiloto × precio del modelo (docs/costos-ia.md).</Formula>
            </dl>
          </details>
        </>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, hint, tone }: { icon: ReactNode; label: string; value: ReactNode; hint: string; tone?: "warning" }) {
  return (
    <Card className={cn("glass gap-2 py-4", tone === "warning" && "border-gold/50")}>
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="flex items-center gap-2 text-xs text-muted-foreground [&>svg]:size-4 [&>svg]:text-brand">
          {icon}
          {label}
        </span>
        <span className={cn("text-2xl font-bold tracking-tight", tone === "warning" && "text-gold-foreground")}>{value}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </CardContent>
    </Card>
  );
}

function Compliance({ target, value }: { target: string | null; value: number | null }) {
  if (!target) return <span className="text-xs text-muted-foreground">Sin objetivo definido</span>;
  return (
    <span className="flex flex-col text-sm">
      <span className={cn("font-medium", value !== null && value < 80 && "text-gold-foreground")}>{value === null ? "Sin datos" : `${value}%`}</span>
      <span className="text-xs text-muted-foreground">objetivo {target}</span>
    </span>
  );
}

function Formula({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-medium text-foreground">{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}
