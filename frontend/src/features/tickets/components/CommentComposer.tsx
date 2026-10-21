import { useState, type FormEvent } from "react";
import { LockIcon, SendIcon } from "lucide-react";
import type { CommentVisibility, TicketDetail } from "@reto/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useIdempotencyKey } from "@/lib/idempotency";
import { useAddComment } from "../api";
import { toast } from "@/components/feedback/toast-store";

export function CommentComposer({ ticket }: { ticket: TicketDetail }) {
  const { permissions } = ticket;
  const canPublic = permissions.can_comment;
  const canInternal = permissions.can_add_internal_note;
  const [visibility, setVisibility] = useState<CommentVisibility>(canPublic ? "public" : "internal");
  const [body, setBody] = useState("");
  const [requestsInfo, setRequestsInfo] = useState(false);
  const key = useIdempotencyKey();
  const addComment = useAddComment(ticket.id);

  if (!canPublic && !canInternal) return null;
  const internal = visibility === "internal";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;
    // La misma clave en cada reintento: un doble envío no duplica el comentario.
    addComment.mutate(
      {
        body: { body: body.trim(), visibility, requests_info: !internal && requestsInfo },
        idempotencyKey: key.current(),
      },
      {
        onSuccess: () => {
          key.reset();
          setBody("");
          setRequestsInfo(false);
          toast.success(
            internal ? "Nota interna guardada" : requestsInfo ? "Solicitud de información enviada" : "Respuesta enviada",
            { description: internal ? "Solo la ve el equipo." : undefined },
          );
        },
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {canInternal && (
        <ToggleGroup
          type="single"
          variant="outline"
          value={visibility}
          onValueChange={(value) => value && setVisibility(value as CommentVisibility)}
          aria-label="Visibilidad del comentario"
          className="w-full sm:w-auto"
        >
          {canPublic && (
            <ToggleGroupItem value="public" className="flex-1 sm:flex-none">
              {/* En móvil, texto corto para que las dos opciones quepan en una fila. */}
              <span className="sm:hidden">Respuesta pública</span>
              <span className="hidden sm:inline">Respuesta al solicitante</span>
            </ToggleGroupItem>
          )}
          <ToggleGroupItem value="internal" className="flex-1 sm:flex-none">
            <LockIcon data-icon="inline-start" aria-hidden="true" />
            Nota interna
          </ToggleGroupItem>
        </ToggleGroup>
      )}
      <Field>
        <FieldLabel htmlFor="comment-body">{internal ? "Nota interna (solo la ve el equipo)" : "Escribe una respuesta"}</FieldLabel>
        <Textarea
          id="comment-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10000}
          rows={4}
          placeholder={internal ? "Hallazgos, hipótesis, próximos pasos…" : "Escribe tu mensaje"}
          className={internal ? "border-gold/50 bg-gold-soft/50" : undefined}
        />
      </Field>
      {addComment.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{addComment.error.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {permissions.can_request_info && !internal ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="requests-info"
              checked={requestsInfo}
              onCheckedChange={(checked) => setRequestsInfo(checked === true)}
            />
            <Label htmlFor="requests-info">Pedir información al solicitante</Label>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {internal ? "No se notifica al solicitante." : "El equipo de soporte verá tu respuesta."}
          </span>
        )}
        <Button type="submit" disabled={addComment.isPending || !body.trim()}>
          {addComment.isPending ? <Spinner aria-label="Enviando" data-icon="inline-start" /> : <SendIcon data-icon="inline-start" aria-hidden="true" />}
          {internal ? "Guardar nota" : "Enviar"}
        </Button>
      </div>
    </form>
  );
}
