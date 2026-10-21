import type { ReactNode } from "react";
import { Link } from "react-router";
import { BookOpenCheckIcon, BotIcon, TriangleAlertIcon } from "lucide-react";
import { escalationReasonLabel, type Metrics } from "@reto/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
