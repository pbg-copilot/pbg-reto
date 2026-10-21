export const dateLabel = (value?: string | null) => value
  ? new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })
  : "Fecha no disponible";

export const textValue = (value: { original?: string | null; es?: string | null; en?: string | null }) =>
  value.original ?? value.es ?? value.en ?? "Texto no disponible";

export function formattedText(value: string) {
  return value.split(/(\*\*[\s\S]+?\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part.replace(/\*\*/g, ""),
  );
}

export function assistantDisplayText(value: string) {
  return value
    .replace(/(?:^|\n)[ \t]*(?:[-*][ \t]+)?(?:\*\*)?(?:fuentes?|sources?)(?:[ \t]+consultadas?)?(?:\*\*)?[ \t]*:[^\r\n]*/gi, "")
    .replace(/\s+(?:fuentes?|sources?)(?:[ \t]+consultadas?)?[ \t]*:[^\r\n]*$/i, "")
    .replace(/\bleads-store\/books\/[^\s`),;]+/gi, "")
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, "")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
}
