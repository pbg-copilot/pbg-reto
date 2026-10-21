import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import {
  ActivityIcon,
  BotIcon,
  CircleAlertIcon,
  ClockIcon,
  FileSpreadsheetIcon,
  HelpCircleIcon,
  InboxIcon,
  MessagesSquareIcon,
  RotateCcwIcon,
  SettingsIcon,
  SparklesIcon,
  TimerIcon,
} from "lucide-react";
import { METRIC_GROUPS, type MetricGroup, type Metrics } from "@reto/shared";
import { toast } from "@/components/feedback/toast-store";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { formatDuration, formatMinutesTarget, useExportMetrics, useMetrics } from "./api";
import { DistributionChart, EvolutionChart } from "./charts";
import { LiveStatus } from "./LiveStatus";
import { OperationsSection } from "./OperationsSection";
import { AssistantCard } from "./RangeSections";

// Panel de soporte (spec 007): secciones en pestañas en lugar de una página larga (AC-007.16).
// La pestaña, el rango y la agrupación viven en la URL: se pueden compartir y Atrás funciona.

const SECTIONS = [
  { value: "ahora", label: "Ahora mismo", icon: ActivityIcon },
  { value: "atencion", label: "Atención", icon: TimerIcon },
  { value: "asistente", label: "Asistente IA", icon: BotIcon },
  { value: "formulas", label: "Fórmulas", icon: HelpCircleIcon },
] as const;
type Section = (typeof SECTIONS)[number]["value"];

const PRESETS = ["7", "30", "90"];
const GROUP_PARAM: Record<MetricGroup, string> = { day: "dia", week: "semana", month: "mes" };
const DAY = 86_400_000;
const MAX_DAYS = 366;

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const isDay = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const shiftDay = (day: string, days: number) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY));
const rangeLabel = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const formatDay = (day: string) => rangeLabel.format(new Date(`${day}T00:00:00Z`));

function rangeFor(days: number) {
  const to = isoDay(new Date(Date.now() + DAY));
  return { from: shiftDay(to, -days), to };
}

// Lee y escribe el estado del panel en la URL (?seccion=…&dias=… o ?desde=…&hasta=…&agrupar=…).
function useDashboardState() {
  const [params, setParams] = useSearchParams();
  const sectionParam = params.get("seccion");
  const section: Section = SECTIONS.some((s) => s.value === sectionParam) ? (sectionParam as Section) : "ahora";
  const from = params.get("desde");
  const until = params.get("hasta");
  const custom = isDay(from) && isDay(until) && from <= until;
  const days = PRESETS.includes(params.get("dias") ?? "") ? params.get("dias")! : "30";
  // `hasta` es inclusivo para la persona; la API recibe el fin excluido.
  const range = custom ? { from, to: shiftDay(until, 1) } : rangeFor(Number(days));
  // Sin elección explícita, la agrupación sigue al largo del rango para que las barras se lean.
  const span = (Date.parse(range.to) - Date.parse(range.from)) / DAY;
  const autoGroup: MetricGroup = span <= 31 ? "day" : span <= 186 ? "week" : "month";
  const group = METRIC_GROUPS.find((g) => GROUP_PARAM[g] === params.get("agrupar")) ?? autoGroup;

  // Solo navega si la URL cambia (por ejemplo, al elegir la agrupación que ya está activa).
  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    if (next.toString() !== params.toString()) setParams(next);
  };

  const setGroup = (value: MetricGroup) => update({ agrupar: value === autoGroup ? null : GROUP_PARAM[value] });

  return { section, custom, days, group, range, update, setGroup };
}

const usd = (value: number) => `US$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`;

export function MetricsPage() {
  const state = useDashboardState();
  const { range, group } = state;
  const metrics = useMetrics(range.from, range.to, group);
  const exporter = useExportMetrics();
  const m = metrics.data;

  useEffect(() => {
    document.title = "RETO · Métricas";
  }, []);

  const exportExcel = () =>
    exporter.mutate(
      { from: range.from, to: range.to, group },
      {
        onSuccess: (name) => toast.success("Exportación lista", { description: name }),
        onError: (error) => toast.error("No se pudo exportar", { description: error.message }),
      },
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-primary">Seguimiento</span>
          <h1 className="text-3xl font-bold tracking-tight">Panel de soporte</h1>
          <p className="text-muted-foreground">Qué atender ahora y cómo va la atención en el periodo elegido.</p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin/prioridades">
            <SettingsIcon data-icon="inline-start" aria-hidden="true" />
            Prioridades y objetivos
          </Link>
        </Button>
      </div>

      {/* Activación manual: las flechas mueven el foco y Enter o un clic cambian la pestaña.
          Así cada cambio es una sola entrada del historial y Atrás vuelve a la anterior. */}
      <Tabs
        value={state.section}
        onValueChange={(value) => state.update({ seccion: value === "ahora" ? null : value })}
        activationMode="manual"
        className="gap-4"
      >
        <TabsList aria-label="Secciones del panel" className="h-auto! w-full justify-start overflow-x-auto sm:w-fit">
          {SECTIONS.map(({ value, label, icon: Icon }) => (
            <TabsTrigger key={value} value={value} className="flex-none px-3 py-1.5">
              <Icon aria-hidden="true" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {(state.section === "atencion" || state.section === "asistente") && (
          <div className="glass flex flex-col gap-3 rounded-xl p-3 lg:flex-row lg:items-center lg:justify-between">
            <RangePicker key={state.custom ? "custom" : state.days} state={state} />
            <div className="flex flex-wrap items-center gap-2">
              {metrics.isPlaceholderData && <Spinner aria-label="Cargando el nuevo rango" />}
              <LiveStatus query={metrics} />
              <Button onClick={exportExcel} disabled={exporter.isPending || !m}>
                {exporter.isPending ? <Spinner data-icon="inline-start" /> : <FileSpreadsheetIcon data-icon="inline-start" aria-hidden="true" />}
                Exportar a Excel
              </Button>
            </div>
          </div>
        )}

        <TabsContent value="ahora">
          <OperationsSection />
        </TabsContent>

        <TabsContent value="atencion" className="flex flex-col gap-6">
          <RangeState metrics={metrics} range={range}>
            {(data) => <AttentionSection metrics={data} group={group} onGroupChange={state.setGroup} />}
          </RangeState>
        </TabsContent>

        <TabsContent value="asistente" className="flex flex-col gap-6">
          <RangeState metrics={metrics} range={range}>
            {(data) => <AssistantSection metrics={data} group={group} onGroupChange={state.setGroup} />}
          </RangeState>
        </TabsContent>

        <TabsContent value="formulas">
          <Formulas />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// 7, 30 o 90 días, o un rango personalizado (AC-007.17). Las fechas se validan aquí antes de
// pedirlas, así un error de tipeo no borra lo que se está viendo.
function RangePicker({ state }: { state: ReturnType<typeof useDashboardState> }) {
  const inclusiveTo = shiftDay(state.range.to, -1);
  const [draft, setDraft] = useState({ from: state.range.from, to: inclusiveTo });
  const today = isoDay(new Date());

  const error = !isDay(draft.from) || !isDay(draft.to)
    ? "Completa las dos fechas."
    : draft.from > draft.to
      ? "La fecha de inicio debe ser anterior o igual a la de fin."
      : (Date.parse(draft.to) - Date.parse(draft.from)) / DAY + 1 > MAX_DAYS
        ? "El rango máximo es de un año."
        : null;

  const change = (patch: Partial<typeof draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (isDay(next.from) && isDay(next.to) && next.from <= next.to && (Date.parse(next.to) - Date.parse(next.from)) / DAY + 1 <= MAX_DAYS)
      state.update({ desde: next.from, hasta: next.to, dias: null });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          value={state.custom ? "custom" : state.days}
          onValueChange={(value) => {
            if (!value) return;
            if (value === "custom") {
              setDraft({ from: state.range.from, to: inclusiveTo });
              state.update({ desde: state.range.from, hasta: inclusiveTo, dias: null });
            } else state.update({ dias: value === "30" ? null : value, desde: null, hasta: null });
          }}
          aria-label="Periodo"
          className="flex-wrap"
        >
          {PRESETS.map((days) => (
            <ToggleGroupItem key={days} value={days}>
              {days} días
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem value="custom">Personalizado</ToggleGroupItem>
        </ToggleGroup>
        {state.custom && (
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="range-from" className="sr-only">
              Desde
            </Label>
            <Input id="range-from" type="date" className="w-38 sm:w-40" value={draft.from} max={today} onChange={(event) => change({ from: event.target.value })} aria-invalid={!!error} aria-describedby="range-help" />
            <span aria-hidden="true" className="text-muted-foreground">
              –
            </span>
            <Label htmlFor="range-to" className="sr-only">
              Hasta (incluido)
            </Label>
            <Input id="range-to" type="date" className="w-38 sm:w-40" value={draft.to} max={today} onChange={(event) => change({ to: event.target.value })} aria-invalid={!!error} aria-describedby="range-help" />
          </div>
        )}
      </div>
      <p id="range-help" className={cn("text-xs", state.custom && error ? "text-destructive" : "text-muted-foreground")}>
        {state.custom && error
          ? error
          : `Tickets creados del ${formatDay(state.range.from)} al ${formatDay(inclusiveTo)} (incluido) · tiempos en calendario, en UTC`}
      </p>
    </div>
  );
}

function RangeState({ metrics, range, children }: { metrics: ReturnType<typeof useMetrics>; range: { from: string; to: string }; children: (data: Metrics) => ReactNode }) {
  if (metrics.isError && !metrics.data)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{metrics.error.message}</AlertDescription>
      </Alert>
    );
  if (!metrics.data)
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={`Cargando del ${range.from} al ${range.to}`}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
        <Skeleton className="h-80 sm:col-span-2 lg:col-span-3" />
      </div>
    );
  return <>{children(metrics.data)}</>;
}

type SectionProps = { metrics: Metrics; group: MetricGroup; onGroupChange: (group: MetricGroup) => void };

function AttentionSection({ metrics: m, group, onGroupChange }: SectionProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6" data-testid="kpis">
        <Kpi icon={<InboxIcon />} label="Abiertos" value={m.by_status.open} hint={`${m.total} tickets en el rango`} />
        <Kpi icon={<ClockIcon />} label="En revisión" value={m.by_status.in_review} hint={`${m.by_status.closed} cerrados`} />
        <Kpi
          icon={<CircleAlertIcon />}
          label="Sin atender"
          value={m.unattended}
          hint="Abiertos sin respuesta pública"
          tone={m.unattended > 0 ? "warning" : undefined}
        />
        <Kpi icon={<RotateCcwIcon />} label="Tasa de reapertura" value={m.reopen_rate === null ? "—" : `${m.reopen_rate}%`} hint={`${m.reopened} reabiertos`} />
        <Kpi
          icon={<TimerIcon />}
          label="Primera respuesta"
          value={formatDuration(m.first_response.p50)}
          hint={`Mediana · p90 ${formatDuration(m.first_response.p90)}`}
        />
        <Kpi icon={<TimerIcon />} label="Resolución" value={formatDuration(m.resolution.p50)} hint={`Mediana · p90 ${formatDuration(m.resolution.p90)}`} />
      </div>

      <EvolutionChart series={m.series} group={group} onGroupChange={onGroupChange} metrics={["volume", "first_response", "resolution", "reopened"]} defaultMetric="volume" />

      <div className="grid gap-6 lg:grid-cols-2">
        <DistributionChart metrics={m} />
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">Cumplimiento por prioridad</CardTitle>
            <CardDescription>Solo se calcula si la prioridad tiene un objetivo configurado.</CardDescription>
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
      </div>
    </>
  );
}

function AssistantSection({ metrics: m, group, onGroupChange }: SectionProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="ai-kpis">
        <Kpi icon={<MessagesSquareIcon />} label="Conversaciones" value={m.assistant.conversations} hint={`${m.assistant.escalated} escaladas a ticket`} />
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
          hint={`${m.ai.conversations} con respuesta del modelo`}
        />
        <Kpi icon={<SparklesIcon />} label="Usos del copiloto" value={m.ai.copilot_uses} hint="Resúmenes y respuestas sugeridas" />
      </div>
      <EvolutionChart
        title="Evolución del asistente"
        series={m.series}
        group={group}
        onGroupChange={onGroupChange}
        metrics={["conversations", "ai_cost"]}
        defaultMetric="conversations"
      />
      <AssistantCard assistant={m.assistant} />
    </>
  );
}

function Formulas() {
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">¿Cómo se calcula?</CardTitle>
        <CardDescription>Las mismas fórmulas del README y de la exportación a Excel.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm text-muted-foreground md:grid-cols-2">
          <Formula term="Rango">Tickets creados entre las fechas elegidas, en tiempo calendario (sin horario laboral), en UTC.</Formula>
          <Formula term="Primera respuesta (TPR)">
            Primer comentario <strong>público</strong> de un admin − creación. Las notas internas, la asignación y los cambios de estado no cuentan. No se recalcula al reabrir.
          </Formula>
          <Formula term="Resolución (TR)">Último cierre como «Resuelto» − creación. Reabrir alarga el TR. Los cierres por otros motivos no cuentan.</Formula>
          <Formula term="Sin atender">Tickets abiertos que todavía no tienen respuesta pública del equipo.</Formula>
          <Formula term="Tasa de reapertura">Tickets reabiertos al menos una vez / tickets resueltos.</Formula>
          <Formula term="Cumplimiento">% de tickets con TPR (o TR) dentro del objetivo de su prioridad. Sin objetivo: «Sin objetivo definido». Nunca se muestran plazos al solicitante.</Formula>
          <Formula term="Mediana y p90">La mediana es el valor del medio; el p90 deja al 90 % de los tickets por debajo. Son más robustos que el promedio ante casos extremos.</Formula>
          <Formula term="Evolución por periodo">Cada periodo (día, semana desde el lunes o mes) cuenta lo ocurrido en él. Las medianas son de los tickets creados en ese periodo.</Formula>
          <Formula term="Costo de IA">Tokens guardados de cada respuesta del asistente y de cada uso del copiloto × precio del modelo (docs/costos-ia.md).</Formula>
          <Formula term="Esperan al equipo">El solicitante respondió después de la última respuesta del equipo y el ticket no está cerrado.</Formula>
          <Formula term="Esperan al solicitante">Hay una solicitud de información del equipo más nueva que la última respuesta del solicitante.</Formula>
          <Formula term="Resueltas sin ticket">Conversaciones que terminaron con «Sí, se resolvió» / (resueltas + escaladas a ticket). Las que siguen en curso no cuentan.</Formula>
          <Formula term="Artículos que no funcionaron">Veces que la persona respondió «No, sigue igual» a un artículo. Ayuda a decidir qué revisar en el catálogo.</Formula>
          <Formula term="Exportar a Excel">Un .xlsx con Resumen, Evolución, Por prioridad, Por categoría y Tickets del rango. Sin datos del solicitante, notas internas ni descripciones.</Formula>
        </dl>
      </CardContent>
    </Card>
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
