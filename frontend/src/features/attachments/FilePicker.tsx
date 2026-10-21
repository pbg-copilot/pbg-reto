import { useId, useRef, useState, type DragEvent } from "react";
import { FileIcon, ImageIcon, PaperclipIcon, XIcon } from "lucide-react";
import { ATTACHMENT_EXTENSIONS, checkFileBeforeUpload, formatBytes, UPLOAD_MAX_FILES } from "@reto/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT = ATTACHMENT_EXTENSIONS.join(",");

// Archivos elegidos antes de enviar: zona de arrastrar y soltar + botón, con la misma
// validación que el servidor (tipo y tamaño) para dar errores claros antes de subir.
export function FilePicker({
  files,
  onChange,
  disabled,
  compact = false,
  label = "Adjuntar archivos",
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  function add(list: FileList | File[]) {
    const incoming = Array.from(list);
    const problems = incoming.map(checkFileBeforeUpload).filter((problem): problem is string => problem !== null);
    const valid = incoming.filter((file) => checkFileBeforeUpload(file) === null);
    const merged = [...files, ...valid].slice(0, UPLOAD_MAX_FILES);
    if (files.length + valid.length > UPLOAD_MAX_FILES) problems.push(`Puedes adjuntar hasta ${UPLOAD_MAX_FILES} archivos a la vez.`);
    setErrors(problems);
    onChange(merged);
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) add(event.dataTransfer.files);
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-2 text-sm text-muted-foreground transition-colors",
          compact ? "border-transparent p-0" : "px-3 py-2.5",
          dragging && "border-brand bg-brand/5",
        )}
      >
        <Button type="button" variant="outline" size="sm" disabled={disabled || files.length >= UPLOAD_MAX_FILES} onClick={() => input.current?.click()} aria-describedby={hintId}>
          <PaperclipIcon data-icon="inline-start" aria-hidden="true" />
          {label}
        </Button>
        <span id={hintId} className={cn("text-xs", compact && "sr-only")}>
          o arrastra aquí · PNG, JPEG, WEBP, GIF, PDF o texto · hasta {UPLOAD_MAX_FILES} de 10 MB
        </span>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="file-input"
          onChange={(event) => {
            if (event.target.files) add(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Archivos para adjuntar">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex max-w-full items-center gap-1.5 rounded-full border bg-card py-1 pr-1 pl-2.5 text-xs">
              {file.type.startsWith("image/") ? <ImageIcon aria-hidden="true" className="size-3.5 shrink-0" /> : <FileIcon aria-hidden="true" className="size-3.5 shrink-0" />}
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-muted-foreground">{formatBytes(file.size)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-5 rounded-full"
                aria-label={`Quitar ${file.name}`}
                disabled={disabled}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
              >
                <XIcon className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="flex flex-col gap-1 text-xs text-destructive">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function UploadProgress({ value }: { value: number | null }) {
  if (value === null) return null;
  const percent = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      Subiendo… {percent}%
    </div>
  );
}
