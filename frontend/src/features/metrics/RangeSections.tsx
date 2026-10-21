import type { ReactNode } from "react";
import { Link } from "react-router";
import { BookOpenCheckIcon, BotIcon, TriangleAlertIcon } from "lucide-react";
import { escalationReasonLabel, type Metrics } from "@reto/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const dayLabel = new Intl.DateTimeFormat("es", { day: "numeric", month: "short", timeZone: "UTC" });

// Creados y cerrados por día. Cada barra tiene su texto para lectores de pantalla.
export function TrendCard({ trend }: { trend: Metrics["trend"] }) {
  const max = Math.max(1, ...trend.flatMap((day) => [day.created, day.closed]));
  const totals = trend.reduce((sum, day) => ({ created: sum.created + day.created, closed: sum.closed + day.closed }), { created: 0, closed: 0 });
  const first = trend[0];
  const last = trend.at(-1);
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">Tendencia diaria</CardTitle>
        <CardDescription>
          {totals.created} creados y {totals.closed} cerrados en el rango
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-brand" /> Creados
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-success" /> Cerrados
          </span>
        </div>
        <ol className="flex h-32 items-end gap-px" aria-label="Tickets por día">
          {trend.map((day) => {
            const label = `${dayLabel.format(new Date(`${day.day}T00:00:00Z`))}: ${day.created} creados, ${day.closed} cerrados`;
            return (
              <li key={day.day} className="flex h-full min-w-0 flex-1 items-end gap-px" title={label}>
                <span className="sr-only">{label}</span>
                <span className="w-1/2 rounded-t-sm bg-brand" style={{ height: `${(day.created / max) * 100}%` }} />
                <span className="w-1/2 rounded-t-sm bg-success" style={{ height: `${(day.closed / max) * 100}%` }} />
              </li>
            );
          })}
        </ol>
        {first && last && (
          <div className="flex justify-between text-xs text-muted-foreground" aria-hidden="true">
            <span>{dayLabel.format(new Date(`${first.day}T00:00:00Z`))}</span>
            <span>{dayLabel.format(new Date(`${last.day}T00:00:00Z`))}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Eficacia del asistente: cuánto resuelve sin ticket, por qué escala y qué artículos fallan
// (huecos del catálogo para revisar).
export function AssistantCard({ assistant }: { assistant: Metrics["assistant"] }) {
  const finished = assistant.resolved_without_ticket + assistant.escalated;
  return (
    <Card className="glass" data-testid="assistant-effectiveness">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BotIcon aria-hidden="true" className="size-4 text-brand" />
          Asistente de IA
        </CardTitle>
        <CardDescription>Conversaciones iniciadas en el rango</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-3">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">Resueltas sin ticket</span>
          <span className="text-3xl font-bold tracking-tight">{assistant.deflection_rate === null ? "—" : `${assistant.deflection_rate}%`}</span>
          <span className="text-xs text-muted-foreground">
            {assistant.resolved_without_ticket} resueltas · {assistant.escalated} escaladas · {assistant.conversations - finished} en curso
          </span>
          {assistant.escalation_reasons.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {assistant.escalation_reasons.map((row) => (
                <li key={row.reason} className="flex justify-between gap-2">
                  <span>{escalationReasonLabel[row.reason as keyof typeof escalationReasonLabel] ?? row.reason}</span>
                  <span className="text-muted-foreground">{row.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ArticleList
          icon={<BookOpenCheckIcon aria-hidden="true" className="size-4 text-success" />}
          title="Artículos más sugeridos"
          empty="El asistente no sugirió artículos en el rango."
          rows={assistant.top_articles.map((row) => ({ id: row.article_id, title: row.title, value: `${row.uses} usos` }))}
        />
        <ArticleList
          icon={<TriangleAlertIcon aria-hidden="true" className="size-4 text-gold-foreground" />}
          title="Artículos que no funcionaron"
          hint="Candidatos a revisar o mejorar"
          empty="Ningún artículo falló en el rango."
          rows={assistant.failed_articles.map((row) => ({ id: row.article_id, title: row.title, value: `${row.failures} fallos` }))}
        />
      </CardContent>
    </Card>
  );
}

function ArticleList({ icon, title, hint, empty, rows }: { icon: ReactNode; title: string; hint?: string; empty: string; rows: { id: string; title: string; value: string }[] }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex justify-between gap-2">
              <Link to={`/admin/catalogo/${row.id}`} className="truncate hover:underline">
                {row.title}
              </Link>
              <span className="shrink-0 text-muted-foreground">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
