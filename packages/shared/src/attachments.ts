import { z } from "zod";

// Política de archivos (specs/006-attachments/spec.md). La usan el servidor (validación real
// con magic bytes) y el cliente (validación previa para dar errores claros antes de subir).

export const ATTACHMENT_TYPES = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt", ".log"],
} as const satisfies Record<string, readonly string[]>;
export type AttachmentMime = keyof typeof ATTACHMENT_TYPES;

export const ATTACHMENT_EXTENSIONS = Object.values(ATTACHMENT_TYPES).flat();
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const isImageMime = (mime: string) => (IMAGE_MIMES as readonly string[]).includes(mime);

export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const UPLOAD_MAX_FILES = 5;
// Las capturas que se comparten con el asistente (visión) tienen un límite menor.
export const AI_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const attachmentTypeLabel: Record<AttachmentMime, string> = {
  "image/png": "Imagen PNG",
  "image/jpeg": "Imagen JPEG",
  "image/webp": "Imagen WEBP",
  "image/gif": "Imagen GIF",
  "application/pdf": "PDF",
  "text/plain": "Texto",
};

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Validación previa en el cliente (el servidor vuelve a validar el contenido real).
export function checkFileBeforeUpload(file: { name: string; size: number }): string | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!(ATTACHMENT_EXTENSIONS as readonly string[]).includes(extension))
    return `«${file.name}» no es un tipo admitido. Usa PNG, JPEG, WEBP, GIF, PDF o texto (.txt, .log).`;
  if (file.size === 0) return `«${file.name}» está vacío.`;
  if (file.size > UPLOAD_MAX_BYTES) return `«${file.name}» pesa ${formatBytes(file.size)}; el máximo es ${formatBytes(UPLOAD_MAX_BYTES)}.`;
  return null;
}

const isoDate = z.string().describe("Fecha ISO 8601 (UTC)");

export const attachmentSchema = z.object({
  id: z.string(),
  original_name: z.string(),
  mime_type: z.enum(Object.keys(ATTACHMENT_TYPES) as [AttachmentMime, ...AttachmentMime[]]),
  size_bytes: z.number().int(),
  visibility: z.enum(["public", "internal"]),
  comment_id: z.string().nullable(),
  source: z.enum(["ticket", "chat"]).describe("chat: se adjuntó en la conversación con el asistente antes de escalar"),
  uploader: z.object({ id: z.string(), name: z.string() }),
  created_at: isoDate,
  status: z.enum(["active", "removed"]),
  // Solo si se retiró: el archivo deja de servirse y queda la traza (§09).
  removal: z.object({ by: z.string(), at: isoDate, reason: z.string() }).nullable(),
  download_url: z.string().nullable().describe("Ruta autorizada de descarga; null si se retiró"),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const uploadResponseSchema = z.object({ attachments: z.array(attachmentSchema) });
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const removeAttachmentBodySchema = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});
export type RemoveAttachmentBody = z.infer<typeof removeAttachmentBodySchema>;
