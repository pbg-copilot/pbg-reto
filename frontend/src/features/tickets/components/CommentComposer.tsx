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
import { ApiError } from "@/lib/api";
import { useAddComment } from "../api";
import { toast } from "@/components/feedback/toast-store";
import { FilePicker, UploadProgress } from "@/features/attachments/FilePicker";
import { useUploadTicketAttachments } from "@/features/attachments/api";

export function CommentComposer({ ticket }: { ticket: TicketDetail }) {
  const { permissions } = ticket;
  const canPublic = permissions.can_comment;
  const canInternal = permissions.can_add_internal_note;
  const [visibility, setVisibility] = useState<CommentVisibility>(canPublic ? "public" : "internal");
  const [body, setBody] = useState("");
  const [requestsInfo, setRequestsInfo] = useState(false);
  const key = useIdempotencyKey();
  const uploadKey = useIdempotencyKey();
  const addComment = useAddComment(ticket.id);
  const upload = useUploadTicketAttachments(ticket.id);
  const [files, setFiles] = useState<File[]>([]);
  const [pendingCommentId, setPendingCommentId] = useState<string | null>(null);

  if (!canPublic && !canInternal) return null;
  const internal = visibility === "internal";
  const busy = addComment.isPending || upload.isPending;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text && files.length === 0) return;
    const asked = !internal && requestsInfo;
    try {
      let commentId = pendingCommentId;
      if (text) {
        // La misma clave en cada reintento: un doble envío no duplica el comentario.
        const created = await addComment.mutateAsync({
          body: { body: text, visibility, requests_info: asked },
          idempotencyKey: key.current(),
        });
        key.reset();
        setBody("");
        setRequestsInfo(false);
        commentId = created.id;
      }
      const count = files.length;
      if (count > 0) {
        // Si el comentario se creó y la subida falla, el reintento adjunta al mismo comentario.
        setPendingCommentId(commentId);
        await upload.mutateAsync({
          files,
          fields: commentId ? { comment_id: commentId } : { visibility },
          idempotencyKey: uploadKey.current(),
        });
        uploadKey.reset();
        setFiles([]);
        setPendingCommentId(null);
      }
      const attached = count > 0 ? ` con ${count} adjunto${count > 1 ? "s" : ""}` : "";
      toast.success(
        !text ? `${count} archivo${count > 1 ? "s" : ""} adjuntado${count > 1 ? "s" : ""}` : internal ? `Nota interna guardada${attached}` : asked ? `Solicitud de información enviada${attached}` : `Respuesta enviada${attached}`,
        { description: internal ? "Solo la ve el equipo." : undefined },
      );
    } catch (error) {
      // Un 4xx (tipo o tamaño no admitido) cambia el contenido del próximo intento: clave nueva.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) uploadKey.reset();
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
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
      {(permissions.can_attach || canInternal) && (
        <FilePicker files={files} onChange={setFiles} disabled={busy} label={internal ? "Adjuntar (interno)" : "Adjuntar archivos"} />
      )}
      <UploadProgress value={upload.progress} />
      {addComment.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{addComment.error.message}</AlertDescription>
        </Alert>
      )}
      {upload.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {pendingCommentId ? "Tu respuesta se envió, pero los archivos no se subieron: " : ""}
            {upload.error.message}
          </AlertDescription>
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
        <Button type="submit" disabled={busy || (!body.trim() && files.length === 0)}>
          {busy ? <Spinner aria-label="Enviando" data-icon="inline-start" /> : <SendIcon data-icon="inline-start" aria-hidden="true" />}
          {!body.trim() && files.length > 0 ? "Adjuntar" : internal ? "Guardar nota" : "Enviar"}
        </Button>
      </div>
    </form>
  );
}
