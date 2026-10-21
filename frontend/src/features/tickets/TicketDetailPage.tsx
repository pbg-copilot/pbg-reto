import { useEffect, type ReactNode } from "react";
import { Link, useOutletContext, useParams } from "react-router";
import { ArrowLeftIcon, BotIcon, CheckCircle2Icon, FileTextIcon } from "lucide-react";
import { closureReasonLabel, impactLabel, isAdmin, type Agent, type TicketDetail } from "@reto/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { formatDateTime, formatRelative } from "@/lib/format";
import { NotFoundPage } from "@/features/errors/NotFoundPage";
import { useTicket } from "./api";
import { AdminAttributes } from "./components/AdminAttributes";
import { CommentComposer } from "./components/CommentComposer";
import { CommentThread } from "./components/CommentThread";
import { PriorityBadge, StatusBadge } from "./components/badges";
import { StatusActions } from "./components/StatusActions";
import { TicketHistory } from "./components/TicketHistory";
import { useCatalogNames } from "./useCatalogNames";

const SOURCE_LABEL: Record<TicketDetail["source"], string> = {
  manual_form: "Formulario",
  assistant: "Asistente de soporte",
  human_request: "Solicitud de ayuda humana",
};

export function TicketDetailPage() {
  const { id = "" } = useParams();
  const agent = useOutletContext<Agent>();
  const ticket = useTicket(id);
  const names = useCatalogNames();

  useEffect(() => {
    if (ticket.data) document.title = `RETO · ${ticket.data.display_number}`;
  }, [ticket.data]);

  // Ajeno o inexistente: la API responde 404 y no se revela si existe.
  if (ticket.error instanceof ApiError && (ticket.error.status === 404 || ticket.error.status === 400))
    return <NotFoundPage message="No encontramos este ticket o no tienes acceso a él." />;
  if (ticket.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{ticket.error.message}</AlertDescription>
      </Alert>
    );
  if (ticket.isPending)
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );

  const t = ticket.data;
  const admin = isAdmin(agent);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" asChild className="self-start">
          <Link to="/tickets">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            {admin ? "Tickets" : "Mis tickets"}
          </Link>
        </Button>
        <span className="eyebrow font-mono">{t.display_number}</span>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.title}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} />
          <PriorityBadge code={t.priority} name={names.priorityName(t.priority)} />
          <Badge variant="secondary">{names.categoryName(t.category)}</Badge>
          {t.reopened_count > 0 && <Badge variant="outline">Reabierto {t.reopened_count}×</Badge>}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {t.status === "closed" && t.closure_reason && (
            <Alert className="border-success/40 bg-success-soft">
              <CheckCircle2Icon aria-hidden="true" />
              <AlertTitle>
                Cerrado · {closureReasonLabel[t.closure_reason]}
                {t.duplicate_of && (
                  <>
                    {" de "}
                    <Link to={`/tickets/${t.duplicate_of.id}`} className="underline">
                      {t.duplicate_of.display_number}
                    </Link>
                  </>
                )}
              </AlertTitle>
              {t.resolution_summary && (
                <AlertDescription className="whitespace-pre-wrap">{t.resolution_summary}</AlertDescription>
              )}
            </Alert>
          )}

          <Card className="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileTextIcon aria-hidden="true" className="size-4 text-brand" />
                Reporte original
              </CardTitle>
              <CardDescription>
                {t.requester.name} · {formatDateTime(t.created_at)} · {SOURCE_LABEL[t.source]}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{t.original_description}</p>
            </CardContent>
          </Card>

          {t.ai_summary && (
            <Card className="glass border-dashed">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BotIcon aria-hidden="true" className="size-4 text-brand" />
                  Resumen del asistente (IA)
                </CardTitle>
                <CardDescription>Generado automáticamente; puede contener errores. El reporte original es el de arriba.</CardDescription>
              </CardHeader>
              <CardContent>
                <AiSummary summary={t.ai_summary} />
              </CardContent>
            </Card>
          )}

          {t.attempted_steps.length > 0 && (
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base">Pasos ya intentados</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
                  {t.attempted_steps.map((step, index) => (
                    <li key={index}>
                      {step.step} <span className="text-muted-foreground">→ {step.result}</span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Conversación con el equipo</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <CommentThread comments={t.comments} />
              {t.status === "closed" && !t.permissions.can_add_internal_note ? (
                <Alert>
                  <AlertDescription>
                    Este ticket está cerrado. Si el problema volvió, usa «Reabrir ticket» y cuéntanos qué pasó.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <Separator />
                  <CommentComposer ticket={t} />
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Estado</CardTitle>
              <CardDescription>
                Actualizado {formatRelative(t.updated_at)}
                {t.closed_at && ` · cerrado ${formatRelative(t.closed_at)}`}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <StatusBadge status={t.status} className="self-start" />
              <StatusActions ticket={t} />
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Detalles</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <Detail label="Solicitante">{t.requester.name}</Detail>
              <Detail label="Impacto declarado">{impactLabel[t.impact]}</Detail>
              <Detail label="Creado">{formatDateTime(t.created_at)}</Detail>
              {admin && (
                <Detail label="Primera respuesta del equipo">
                  {t.first_response_at ? formatDateTime(t.first_response_at) : "Todavía sin respuesta"}
                </Detail>
              )}
              {admin && <AdminAttributes ticket={t} />}
            </CardContent>
          </Card>

          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Historial</CardTitle>
            </CardHeader>
            <CardContent>
              <TicketHistory events={t.events} names={names} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="eyebrow">{label}</span>
      <span>{children}</span>
    </div>
  );
}

const SUMMARY_LABELS: Record<string, string> = {
  reported_symptom: "Síntoma reportado",
  area: "Área afectada",
  user_goal: "Qué intentaba hacer",
  expected_result: "Resultado esperado",
  observed_error: "Error observado",
  impact: "Impacto",
  confirmed_cause: "Causa confirmada",
};

// Muestra los datos del caso que extrajo el asistente (spec 004), separados del reporte original.
function AiSummary({ summary }: { summary: Record<string, unknown> }) {
  const details = { ...(summary.case_details as Record<string, unknown> | undefined), ...summary };
  const entries = Object.entries(SUMMARY_LABELS)
    .map(([key, label]) => [label, details[key]] as const)
    .filter(([, value]) => value !== undefined);
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {entries.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <dt className="eyebrow">{label}</dt>
          <dd>{value === null ? "Sin confirmar" : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
