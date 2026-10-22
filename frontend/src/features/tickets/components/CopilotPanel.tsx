import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CopyIcon, FileTextIcon, NotebookPenIcon, SparklesIcon, WandSparklesIcon } from "lucide-react";
import type { CopilotDraft, SimilarTicket, TicketDetail } from "@reto/shared";
import { toast } from "@/components/feedback/toast-store";
import { Markdown } from "@/components/Markdown";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/idempotency";
import { useAddComment } from "../api";
import { StatusBadge } from "./badges";

// Copiloto del equipo (spec 007). La IA propone; el admin decide: el resumen se guarda como
// nota interna solo si lo pide, y el borrador va al compositor para editarlo y enviarlo.
export function CopilotPanel({ ticket, onUseDraft }: { ticket: TicketDetail; onUseDraft: (text: string) => void }) {
  const summary = useMutation({ mutationFn: () => api<{ markdown: string }>(`/tickets/${ticket.id}/copilot/summary`, { method: "POST" }) });
  const draft = useMutation({ mutationFn: () => api<CopilotDraft>(`/tickets/${ticket.id}/copilot/reply-draft`, { method: "POST" }) });
  const similar = useQuery({
    queryKey: ["tickets", "similar", ticket.id],
    queryFn: ({ signal }) => api<SimilarTicket[]>(`/tickets/${ticket.id}/similar`, { signal }),
    staleTime: 60_000,
  });
  const addNote = useAddComment(ticket.id);
  const busy = summary.isPending || draft.isPending;

  function requestDraft() {
    draft.mutate(undefined, {
      onSuccess: (result) => {
        onUseDraft(result.markdown);
        toast.info("Borrador en el compositor", { description: "Revísalo y edítalo antes de enviar: nunca se envía solo." });
      },
    });
  }

  function saveSummary(markdown: string) {
    addNote.mutate(
      { body: { body: `Diagnóstico del copiloto (IA, sin confirmar):\n\n${markdown}`, visibility: "internal", requests_info: false }, idempotencyKey: newIdempotencyKey() },
      { onSuccess: () => toast.success("Resumen guardado como nota interna") },
    );
  }

  const error = summary.error ?? draft.error;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => summary.mutate()}>
          {summary.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <FileTextIcon data-icon="inline-start" aria-hidden="true" />}
          Diagnosticar caso
        </Button>
        {ticket.permissions.can_comment && (
          <Button variant="outline" size="sm" disabled={busy} onClick={requestDraft}>
            {draft.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <WandSparklesIcon data-icon="inline-start" aria-hidden="true" />}
            Sugerir respuesta
          </Button>
        )}
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {summary.data && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-gold/50 bg-gold-soft/40 p-3 text-sm" data-testid="copilot-summary">
          <span className="eyebrow flex items-center gap-1 text-gold-foreground">
            <SparklesIcon aria-hidden="true" className="size-3" />
            Diagnóstico de IA · interno · la causa es una hipótesis
          </span>
          <Markdown>{summary.data.markdown}</Markdown>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={addNote.isPending} onClick={() => saveSummary(summary.data.markdown)}>
              <NotebookPenIcon data-icon="inline-start" aria-hidden="true" />
              Guardar como nota interna
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void navigator.clipboard.writeText(summary.data.markdown).then(() => toast.info("Resumen copiado"))}
            >
              <CopyIcon data-icon="inline-start" aria-hidden="true" />
              Copiar
            </Button>
          </div>
        </div>
      )}

      {draft.data && draft.data.articles.length > 0 && (
        <p className="text-xs text-muted-foreground">
          El borrador se apoyó en:{" "}
          {draft.data.articles.map((article, index) => (
            <span key={article.slug}>
              {index > 0 && ", "}
              <Link to={`/soporte/articulos/${article.slug}`} className="underline">
                {article.title}
              </Link>
            </span>
          ))}
        </p>
      )}

      <Separator />
      <div className="flex flex-col gap-2" data-testid="similar-tickets">
        <span className="eyebrow">Posibles duplicados</span>
        {similar.isPending ? (
          <Spinner aria-label="Buscando parecidos" />
        ) : similar.data?.length ? (
          <ul className="flex flex-col gap-2">
            {similar.data.map((item) => (
              <li key={item.id} className="flex flex-col gap-1 text-sm">
                <Link to={`/tickets/${item.id}`} className="font-medium hover:underline">
                  <span className="font-mono text-xs text-muted-foreground">{item.display_number}</span> {item.title}
                </Link>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge status={item.status} />
                  {Math.round(item.similarity * 100)}% parecido
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No hay tickets abiertos parecidos en los últimos 30 días.</p>
        )}
      </div>
    </div>
  );
}
