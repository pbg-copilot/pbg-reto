import { useId, useRef } from "react";
import { EyeIcon, FileIcon, ImageIcon, PaperclipIcon, XIcon } from "lucide-react";
import { ATTACHMENT_EXTENSIONS, formatBytes, isImageMime, type ChatAttachment } from "@reto/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { downloadUrl } from "@/features/attachments/api";

// Botón de clip del compositor del chat: sube al elegir y muestra los adjuntos que se enviarán
// con el próximo mensaje.
export function AttachButton({ onPick, disabled }: { onPick: (files: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => input.current?.click()}>
        <PaperclipIcon data-icon="inline-start" aria-hidden="true" />
        Adjuntar
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ATTACHMENT_EXTENSIONS.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="chat-file-input"
        onChange={(event) => {
          if (event.target.files?.length) onPick(Array.from(event.target.files));
          event.target.value = "";
        }}
      />
    </>
  );
}

export function StagedAttachments({
  attachments,
  onRemove,
  share,
  onShareChange,
  disabled,
}: {
  attachments: ChatAttachment[];
  onRemove: (id: string) => void;
  share: boolean;
  onShareChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const consentId = useId();
  if (attachments.length === 0) return null;
  const images = attachments.filter((attachment) => isImageMime(attachment.mime_type)).length;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-2" aria-label="Adjuntos para enviar">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="flex max-w-full items-center gap-1.5 rounded-full border bg-card py-1 pr-1 pl-2.5 text-xs">
            {isImageMime(attachment.mime_type) ? <ImageIcon aria-hidden="true" className="size-3.5 shrink-0" /> : <FileIcon aria-hidden="true" className="size-3.5 shrink-0" />}
            <span className="truncate">{attachment.original_name}</span>
            <span className="shrink-0 text-muted-foreground">{formatBytes(attachment.size_bytes)}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-5 rounded-full"
              aria-label={`Quitar ${attachment.original_name}`}
              disabled={disabled}
              onClick={() => onRemove(attachment.id)}
            >
              <XIcon className="size-3" />
            </Button>
          </li>
        ))}
      </ul>
      {images > 0 && (
        // Consentimiento explícito, desmarcado por defecto (AC-006.11).
        <div className="flex items-start gap-2 rounded-lg border border-dashed p-2.5">
          <Checkbox id={consentId} checked={share} onCheckedChange={(checked) => onShareChange(checked === true)} disabled={disabled} className="mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <Label htmlFor={consentId}>Permitir que el asistente lea {images === 1 ? "esta imagen" : "estas imágenes"}</Label>
            <span className="text-xs text-muted-foreground">
              Si no lo marcas, el asistente solo ve el nombre y el tipo del archivo. No compartas capturas con contraseñas o datos de clientes.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// Adjuntos de un mensaje ya enviado.
export function MessageAttachments({ attachments }: { attachments: ChatAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <ul className="flex flex-wrap justify-end gap-2" aria-label="Adjuntos del mensaje">
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <a
            href={downloadUrl(attachment.download_url)}
            className="flex items-center gap-2 rounded-xl border bg-card p-1.5 pr-3 text-xs hover:bg-accent"
            aria-label={`Descargar ${attachment.original_name}`}
          >
            {isImageMime(attachment.mime_type) ? (
              <img src={downloadUrl(attachment.download_url, true)} alt="" loading="lazy" className="size-10 rounded-lg object-cover" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <FileIcon aria-hidden="true" className="size-4" />
              </span>
            )}
            <span className="flex min-w-0 flex-col">
              <span className="max-w-40 truncate font-medium">{attachment.original_name}</span>
              <span className="flex items-center gap-1 text-muted-foreground">
                {formatBytes(attachment.size_bytes)}
                {attachment.shared_with_ai && (
                  <>
                    {" · "}
                    <EyeIcon aria-hidden="true" className="size-3" />
                    Compartida con el asistente
                  </>
                )}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
