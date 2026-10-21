import { fileTypeFromBuffer } from "file-type";
import { ATTACHMENT_TYPES, type AttachmentMime } from "@reto/shared";
import { AppError } from "../../lib/errors.js";

const MAX_NAME = 200;

// Nombre seguro para mostrar y para Content-Disposition: sin rutas, sin caracteres de
// control ni separadores, en NFC y con la extensión conservada al recortar.
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex -- se eliminan justamente los caracteres de control
  let name = base.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(/["<>|:*?]/g, "_").trim();
  name = name.replace(/^\.+/, "");
  if (!name) name = "archivo";
  if (name.length > MAX_NAME) {
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    name = name.slice(0, MAX_NAME - extension.length) + extension;
  }
  return name;
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
};

const unsupported = (name: string) =>
  new AppError(415, "unsupported_file_type", `«${name}» no es un tipo admitido o su contenido no coincide con la extensión. Usa PNG, JPEG, WEBP, GIF, PDF o texto (.txt, .log).`);

const isValidUtf8 = (buffer: Buffer) => {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
};

// El tipo sale del contenido (magic bytes), nunca del Content-Type que declara el cliente.
// Tiene que coincidir con la extensión: un HTML renombrado a .png o un PNG renombrado a .pdf
// se rechazan. SVG, HTML y XML no tienen firma binaria y su extensión no está admitida.
export async function detectType(buffer: Buffer, name: string): Promise<AttachmentMime> {
  if (buffer.length === 0) throw new AppError(400, "invalid_request", `«${name}» está vacío.`);
  const extension = extensionOf(name);
  const detected = await fileTypeFromBuffer(buffer.subarray(0, 4100));
  if (detected) {
    const mime = detected.mime as AttachmentMime;
    const allowed = ATTACHMENT_TYPES[mime] as readonly string[] | undefined;
    if (!allowed || !allowed.includes(extension)) throw unsupported(name);
    return mime;
  }
  // Sin firma: solo se acepta texto plano real (UTF-8 válido y sin bytes nulos).
  if ((ATTACHMENT_TYPES["text/plain"] as readonly string[]).includes(extension) && !buffer.includes(0) && isValidUtf8(buffer))
    return "text/plain";
  throw unsupported(name);
}
