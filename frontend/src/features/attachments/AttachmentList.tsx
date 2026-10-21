import { useState, type FormEvent } from "react";
import { DownloadIcon, FileTextIcon, FileXIcon, LockIcon, MessagesSquareIcon, Trash2Icon } from "lucide-react";
import { attachmentTypeLabel, formatBytes, isImageMime, type Attachment } from "@reto/shared";
import { toast } from "@/components/feedback/toast-store";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { downloadUrl, useRemoveAttachment } from "./api";

// Evidencias con nombre, autor, fecha, tamaño, tipo y visibilidad (AC-006.4). Las imágenes se
// previsualizan por el endpoint autorizado (mismo origen, permitido por la CSP).
export function AttachmentList({ attachments, ticketId, canRemove }: { attachments: Attachment[]; ticketId: string; canRemove: boolean }) {
  const [removing, setRemoving] = useState<Attachment | null>(null);
  if (attachments.length === 0) return null;
  return (
    <>
      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Adjuntos">
        {attachments.map((attachment) => (
          <AttachmentItem key={attachment.id} attachment={attachment} canRemove={canRemove} onRemove={() => setRemoving(attachment)} />
        ))}
      </ul>
      <RemoveDialog ticketId={ticketId} attachment={removing} onClose={() => setRemoving(null)} />
    </>
  );
}

function AttachmentItem({ attachment, canRemove, onRemove }: { attachment: Attachment; canRemove: boolean; onRemove: () => void }) {
  const removed = attachment.status === "removed";
  const internal = attachment.visibility === "internal";
  const image = isImageMime(attachment.mime_type);

  if (removed && attachment.removal)
    return (
      <li className="flex items-start gap-3 rounded-xl border border-dashed p-3 text-sm" data-testid="attachment">
        <FileXIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <span className="font-medium">Evidencia retirada</span>
          <span className="text-muted-foreground">
            Por {attachment.removal.by} · <time dateTime={attachment.removal.at}>{formatDateTime(attachment.removal.at)}</time>
          </span>
          <span className="text-muted-foreground">Motivo: {attachment.removal.reason}</span>
        </div>
      </li>
    );

  return (
    <li className={cn("flex items-center gap-3 rounded-xl border p-2.5 text-sm", internal ? "border-gold/40 bg-gold-soft" : "bg-card")} data-testid="attachment">
      <a
        href={downloadUrl(attachment.download_url!)}
        className="shrink-0 overflow-hidden rounded-lg border bg-muted"
        aria-label={`Descargar ${attachment.original_name}`}
      >
        {image ? (
          <img src={downloadUrl(attachment.download_url!, true)} alt="" loading="lazy" className="size-14 object-cover" />
        ) : (
          <span className="flex size-14 items-center justify-center text-muted-foreground">
            <FileTextIcon aria-hidden="true" className="size-6" />
          </span>
        )}
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <a href={downloadUrl(attachment.download_url!)} className="truncate font-medium hover:underline">
          {attachment.original_name}
        </a>
        <span className="truncate text-xs text-muted-foreground">
          {attachmentTypeLabel[attachment.mime_type]} · {formatBytes(attachment.size_bytes)} · {attachment.uploader.name} ·{" "}
          <time dateTime={attachment.created_at} title={formatDateTime(attachment.created_at)}>
            {formatRelative(attachment.created_at)}
          </time>
        </span>
        <span className="flex flex-wrap gap-1">
          {internal && (
            <Badge variant="outline" className="h-4 border-gold/50 px-1.5 text-[10px] text-gold-foreground">
              <LockIcon aria-hidden="true" />
              Interno
            </Badge>
          )}
          {attachment.source === "chat" && (
            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
              <MessagesSquareIcon aria-hidden="true" />
              Desde el chat
            </Badge>
          )}
        </span>
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button variant="ghost" size="icon" asChild>
          <a href={downloadUrl(attachment.download_url!)} aria-label={`Descargar ${attachment.original_name}`}>
            <DownloadIcon />
          </a>
        </Button>
        {canRemove && (
          <Button variant="ghost" size="icon" aria-label={`Retirar ${attachment.original_name}`} onClick={onRemove}>
            <Trash2Icon />
          </Button>
        )}
      </div>
    </li>
  );
}

function RemoveDialog({ ticketId, attachment, onClose }: { ticketId: string; attachment: Attachment | null; onClose: () => void }) {
  const remove = useRemoveAttachment(ticketId);
  const [reason, setReason] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!attachment || reason.trim().length < 3) return;
    remove.mutate(
      { id: attachment.id, body: { reason: reason.trim() } },
      {
        onSuccess: () => {
          toast.success("Evidencia retirada", { description: "Deja de servirse y queda la traza en el historial." });
          setReason("");
          onClose();
        },
      },
    );
  }

  return (
    <Dialog
      open={attachment !== null}
      onOpenChange={(open) => {
        if (!open) {
          remove.reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Retirar evidencia</DialogTitle>
            <DialogDescription>
              «{attachment?.original_name}» dejará de servirse. Queda el registro con tu nombre, la fecha y el motivo.
            </DialogDescription>
          </DialogHeader>
          {remove.error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{remove.error.message}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="remove-reason">Motivo</FieldLabel>
            <Textarea id="remove-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Por ejemplo: contiene datos personales" maxLength={500} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={remove.isPending || reason.trim().length < 3}>
              Retirar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
