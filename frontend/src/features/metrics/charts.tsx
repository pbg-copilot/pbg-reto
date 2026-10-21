import { useState, type CSSProperties } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Label, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { escalationReasonLabel, metricGroupLabel, statusLabel, type MetricGroup, type Metrics, type SeriesPoint } from "@reto/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDuration } from "./api";

// Gráficos del panel (AC-007.18 y AC-007.19) con los charts de shadcn (Recharts).
// La config de cada gráfico no lleva colores: así ChartStyle no inyecta un <style> (la CSP
// solo admite estilos con nonce). Los colores van como tokens en cada serie.

type SeriesKey = Exclude<keyof SeriesPoint, "bucket">;
type Format = "count" | "duration" | "usd";
type ChartKind = "bar" | "line" | "area";

const COLORS = {
  brand: "var(--color-chart-1)",
  primary: "var(--color-chart-2)",
  gold: "var(--color-chart-3)",
  success: "var(--color-chart-4)",
  muted: "var(--color-chart-5)",
};

// Cada métrica abre con el tipo que mejor la lee: barras para cantidades por periodo, líneas
// para tiempos (una mediana no se "apila") y área para un costo que se sigue en el tiempo.
// La persona puede cambiarlo; al cambiar de métrica vuelve al recomendado.
export const EVOLUTION_METRICS = {
  volume: {
    label: "Tickets creados y cerrados",
    hint: "Creados y cerrados en cada periodo",
    format: "count",
    chart: "bar",
    series: [
      { key: "created", label: "Creados", color: COLORS.brand },
      { key: "closed", label: "Cerrados", color: COLORS.success },
    ],
  },
  first_response: {
    label: "Primera respuesta (mediana)",
    hint: "Mediana de TPR de los tickets creados en cada periodo",
    format: "duration",
    chart: "line",
    series: [{ key: "first_response_p50", label: "Primera respuesta", color: COLORS.primary }],
  },
  resolution: {
    label: "Resolución (mediana)",
    hint: "Mediana de TR de los tickets creados en cada periodo y resueltos",
    format: "duration",
    chart: "line",
    series: [{ key: "resolution_p50", label: "Resolución", color: COLORS.gold }],
  },
  reopened: {
    label: "Reaperturas",
    hint: "Tickets reabiertos en cada periodo",
    format: "count",
    chart: "bar",
    series: [{ key: "reopened", label: "Reaperturas", color: COLORS.gold }],
  },
  conversations: {
    label: "Conversaciones con el asistente",
    hint: "Iniciadas en cada periodo, según cómo terminaron",
    format: "count",
    chart: "bar",
    series: [
      { key: "resolved_without_ticket", label: "Resueltas sin ticket", color: COLORS.success },
      { key: "escalated", label: "Escaladas a ticket", color: COLORS.brand },
    ],
  },
  ai_cost: {
    label: "Costo de IA",
    hint: "Chat + copiloto, con los tokens reales de cada respuesta",
    format: "usd",
    chart: "area",
    series: [{ key: "ai_cost_usd", label: "Costo de IA", color: COLORS.primary }],
  },
} satisfies Record<string, { label: string; hint: string; format: Format; chart: ChartKind; series: { key: SeriesKey; label: string; color: string }[] }>;
export type EvolutionMetric = keyof typeof EVOLUTION_METRICS;

const CHART_KINDS: { value: ChartKind; label: string }[] = [
  { value: "bar", label: "Barras" },
  { value: "line", label: "Líneas" },
  { value: "area", label: "Área" },
];

const usd = (value: number) => `US$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`;
const formatValue = (format: Format, value: number | null) =>
  value === null ? "—" : format === "duration" ? formatDuration(value) : format === "usd" ? usd(value) : value.toLocaleString("es");

const dayFormat = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });
const monthFormat = new Intl.DateTimeFormat("es", { month: "short", year: "numeric", timeZone: "UTC" });
export function periodLabel(bucket: string, group: MetricGroup) {
  const date = new Date(`${bucket}T00:00:00Z`);
  if (group === "month") return monthFormat.format(date);
  return group === "week" ? `Sem. ${dayFormat.format(date)}` : dayFormat.format(date);
}

// Resumen en texto para lectores de pantalla: totales de conteos y rango de los tiempos.
function describe(metric: (typeof EVOLUTION_METRICS)[EvolutionMetric], points: SeriesPoint[]) {
  return metric.series
    .map(({ key, label }) => {
      const values = points.map((point) => point[key]).filter((value): value is number => value !== null);
      if (values.length === 0) return `${label}: sin datos`;
      if (metric.format === "count") return `${label}: ${values.reduce((a, b) => a + b, 0)} en total`;
      if (metric.format === "usd") return `${label}: ${usd(values.reduce((a, b) => a + b, 0))} en total`;
      return `${label}: entre ${formatDuration(Math.min(...values))} y ${formatDuration(Math.max(...values))}`;
    })
    .join(". ");
}

export function EvolutionChart({
  series,
  group,
  onGroupChange,
  metrics,
  defaultMetric,
  title = "Evolución",
}: {
  series: Metrics["series"];
  group: MetricGroup;
  onGroupChange: (group: MetricGroup) => void;
  metrics: EvolutionMetric[];
  defaultMetric: EvolutionMetric;
  title?: string;
}) {
  const [metricKey, setMetricKey] = useState<EvolutionMetric>(defaultMetric);
  const [kind, setKind] = useState<ChartKind>(EVOLUTION_METRICS[defaultMetric].chart);
  const metric = EVOLUTION_METRICS[metricKey];
  const config = Object.fromEntries(metric.series.map((s) => [s.key, { label: s.label }])) satisfies ChartConfig;
  const stacked = metricKey === "conversations";
  const points = series.points;

  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="bucket" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tickFormatter={(value: string) => periodLabel(value, series.group)} />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={metric.format === "count" ? 32 : 64}
        allowDecimals={metric.format !== "count"}
        tickFormatter={(value: number) => formatValue(metric.format, value)}
      />
      <ChartTooltip
        // Recharts 3 ordena por nombre: se respeta el orden de las series (Creados, Cerrados…).
        itemSorter={(item) => metric.series.findIndex((s) => s.key === item.dataKey)}
        content={
          <ChartTooltipContent
            labelFormatter={(label) => periodLabel(String(label), series.group)}
            formatter={(value, name, item) => (
              <span className="flex w-full items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-[2px] bg-(--dot)" style={{ "--dot": item.color } as CSSProperties} />
                <span className="flex-1 text-muted-foreground">{config[String(name) as keyof typeof config]?.label ?? name}</span>
                <span className="font-mono font-medium text-foreground tabular-nums">{formatValue(metric.format, typeof value === "number" ? value : null)}</span>
              </span>
            )}
          />
        }
      />
      {metric.series.length > 1 && <ChartLegend itemSorter={null} content={<ChartLegendContent />} />}
    </>
  );

  return (
    <Card className="glass" data-testid="evolution-chart">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{metric.hint}</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={metricKey}
            onValueChange={(value) => {
              setMetricKey(value as EvolutionMetric);
              setKind(EVOLUTION_METRICS[value as EvolutionMetric].chart);
            }}
          >
            <SelectTrigger className="w-full sm:w-72" aria-label="Métrica">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {metrics.map((key) => (
                <SelectItem key={key} value={key}>
                  {EVOLUTION_METRICS[key].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup type="single" variant="outline" size="sm" value={group} onValueChange={(value) => value && onGroupChange(value as MetricGroup)} aria-label="Agrupar por">
            {(Object.keys(metricGroupLabel) as MetricGroup[]).map((value) => (
              <ToggleGroupItem key={value} value={value}>
                {metricGroupLabel[value]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup type="single" variant="outline" size="sm" value={kind} onValueChange={(value) => value && setKind(value as ChartKind)} aria-label="Tipo de gráfico">
            {CHART_KINDS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        <p className="sr-only" aria-live="polite">
          {metric.label} por {metricGroupLabel[series.group].toLowerCase()}. {describe(metric, points)}.
        </p>
        <ChartContainer config={config} className="aspect-auto h-72 w-full" aria-hidden="true">
          {kind === "bar" ? (
            <BarChart data={points} accessibilityLayer={false}>
              {axes}
              {metric.series.map((s) => (
                <Bar key={s.key} dataKey={s.key} fill={s.color} radius={stacked ? 0 : 4} maxBarSize={40} stackId={stacked ? "a" : undefined} />
              ))}
            </BarChart>
          ) : kind === "line" ? (
            <LineChart data={points} accessibilityLayer={false}>
              {axes}
              {metric.series.map((s) => (
                <Line key={s.key} dataKey={s.key} stroke={s.color} strokeWidth={2} dot={points.length <= 31} type="monotone" />
              ))}
            </LineChart>
          ) : (
            <AreaChart data={points} accessibilityLayer={false}>
              {axes}
              {metric.series.map((s) => (
                <Area key={s.key} dataKey={s.key} stroke={s.color} fill={s.color} fillOpacity={0.25} type="monotone" stackId={stacked ? "a" : undefined} />
              ))}
            </AreaChart>
          )}
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

const DIMENSIONS = {
  category: "Por categoría",
  priority: "Por prioridad",
  status: "Por estado",
  escalation: "Motivo de escalamiento",
} as const;
type Dimension = keyof typeof DIMENSIONS;
type DistributionKind = "bar" | "donut";

// La dona solo se ofrece para partes de un total con pocas porciones (hasta 6). Por estado
// abre como dona (3 partes que suman el total); el resto, como barras, que comparan mejor.
const MAX_DONUT_SLICES = 6;
const DEFAULT_KIND: Record<Dimension, DistributionKind> = { category: "bar", priority: "bar", status: "donut", escalation: "bar" };
const SLICE_COLORS = [COLORS.brand, COLORS.success, COLORS.gold, COLORS.primary, COLORS.muted, "var(--muted-foreground)"];
// Los estados usan los mismos colores que sus badges en toda la app.
const STATUS_COLORS: Record<string, string> = { open: COLORS.brand, in_review: COLORS.gold, closed: COLORS.success };

function distribution(metrics: Metrics, dimension: Dimension) {
  const rows = (() => {
    switch (dimension) {
      case "category":
        return metrics.by_category.map((row) => ({ key: row.code, name: row.name, value: row.count }));
      case "priority":
        return metrics.by_priority.map((row) => ({ key: row.code, name: row.name, value: row.count }));
      case "status":
        return (["open", "in_review", "closed"] as const).map((status) => ({ key: status, name: statusLabel[status], value: metrics.by_status[status] }));
      case "escalation":
        return metrics.assistant.escalation_reasons.map((row) => ({
          key: row.reason,
          name: escalationReasonLabel[row.reason as keyof typeof escalationReasonLabel] ?? row.reason,
          value: row.count,
        }));
    }
  })();
  return rows.map((row, i) => ({ ...row, fill: (dimension === "status" ? STATUS_COLORS[row.key] : undefined) ?? SLICE_COLORS[i % SLICE_COLORS.length]! }));
}

export function DistributionChart({ metrics }: { metrics: Metrics }) {
  const [dimension, setDimension] = useState<Dimension>("category");
  const [kind, setKind] = useState<DistributionKind>(DEFAULT_KIND.category);
  const data = distribution(metrics, dimension);
  const total = data.reduce((sum, row) => sum + row.value, 0);
  const donutAllowed = data.length <= MAX_DONUT_SLICES;
  const shown = donutAllowed ? kind : "bar";
  // Etiquetas por clave para la leyenda y el tooltip; sin colores, así ChartStyle no inyecta <style>.
  const config = Object.fromEntries([["value", { label: "Tickets" }], ...data.map((row) => [row.key, { label: row.name }])]) satisfies ChartConfig;

  return (
    <Card className="glass" data-testid="distribution-chart">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-base">Distribución</CardTitle>
          <CardDescription>{total} en el rango</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={dimension}
            onValueChange={(value) => {
              setDimension(value as Dimension);
              setKind(DEFAULT_KIND[value as Dimension]);
            }}
          >
            <SelectTrigger className="w-full sm:w-56" aria-label="Distribuir por">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DIMENSIONS) as Dimension[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {DIMENSIONS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {donutAllowed && (
            <ToggleGroup type="single" variant="outline" size="sm" value={shown} onValueChange={(value) => value && setKind(value as DistributionKind)} aria-label="Tipo de gráfico de distribución">
              <ToggleGroupItem value="bar">Barras</ToggleGroupItem>
              <ToggleGroupItem value="donut">Dona</ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 || total === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Sin datos en el rango.</p>
        ) : (
          <>
            <ul className="sr-only">
              {data.map((row) => (
                <li key={row.key}>
                  {row.name}: {row.value} ({Math.round((100 * row.value) / total)} %)
                </li>
              ))}
            </ul>
            {shown === "donut" ? (
              <ChartContainer config={config} className="mx-auto aspect-square max-h-72 w-full" aria-hidden="true">
                <PieChart accessibilityLayer={false}>
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="key" />} />
                  <Pie data={data} dataKey="value" nameKey="key" innerRadius="58%" outerRadius="85%" strokeWidth={2} stroke="var(--card)">
                    {data.map((row) => (
                      <Cell key={row.key} fill={row.fill} />
                    ))}
                    <Label
                      content={({ viewBox }) =>
                        viewBox && "cx" in viewBox && "cy" in viewBox ? (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                            <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-bold">
                              {total}
                            </tspan>
                            <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 22} className="fill-muted-foreground text-xs">
                              tickets
                            </tspan>
                          </text>
                        ) : null
                      }
                    />
                  </Pie>
                  <ChartLegend itemSorter={null} content={<ChartLegendContent nameKey="key" className="flex-wrap gap-y-1" />} />
                </PieChart>
              </ChartContainer>
            ) : (
              <ChartContainer config={config} className="aspect-auto w-full" style={{ height: Math.max(160, data.length * 40) }} aria-hidden="true">
                <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }} accessibilityLayer={false}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={150} />
                  <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel nameKey="value" />} />
                  <Bar dataKey="value" fill={COLORS.brand} radius={4} label={{ position: "right", className: "fill-foreground text-xs" }} />
                </BarChart>
              </ChartContainer>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
