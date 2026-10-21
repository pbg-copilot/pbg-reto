// Guards del asistente (specs/004-assistant/plan.md → Guards). Funciones puras.

// Patrones con forma de secreto: se enmascaran antes de guardar y de enviar al modelo.
const SECRET_PATTERNS: RegExp[] = [
  // "contraseña: Hola123", "mi clave es x9!k", "pin 1234", "código de acceso 448812".
  // El valor debe tener un dígito o símbolo: evita falsos positivos como "contraseña incorrecta",
  // "la clave del problema" o "código 500".
  /(?<![\p{L}\p{N}])(contrase(?:ñ|n)a|password|passwd|clave|token|pin|c[oó]digo de (?:acceso|verificaci[oó]n))(?![\p{L}\p{N}])(\s*[:=]\s*|\s+es\s+|\s+)((?=[^\s,;]*[\d!@#$%^&*_+=?])[^\s,;]{4,})/giu,
  // Claves de API conocidas y JWT
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let result = text;
  result = result.replace(SECRET_PATTERNS[0]!, (_match, label: string, separator: string) => {
    redacted = true;
    return `${label}${separator || " "}[DATO OCULTO]`;
  });
  for (const pattern of SECRET_PATTERNS.slice(1))
    result = result.replace(pattern, () => {
      redacted = true;
      return "[DATO OCULTO]";
    });
  return { text: result, redacted };
}

const TICKET_MENTION = /\bTCK-0*(\d{1,9})\b/gi;

// El modelo no puede inventar números de ticket: solo se conservan los que el actor puede ver.
export function sanitizeTicketMentions(text: string, allowedNumbers: Set<number>): string {
  return text.replace(TICKET_MENTION, (match, digits: string) =>
    allowedNumbers.has(Number(digits)) ? match.toUpperCase() : "el ticket indicado",
  );
}

export const mentionedTicketNumbers = (text: string) =>
  [...text.matchAll(TICKET_MENTION)].map((match) => Number(match[1]));

// Contenido de herramientas (artículos, resultados): datos, no instrucciones.
export const wrapUntrusted = (data: unknown) =>
  `<untrusted_content>\n${JSON.stringify(data)}\n</untrusted_content>`;

export function unwrapUntrusted(text: string): unknown {
  const match = /<untrusted_content>\n([\s\S]*)\n<\/untrusted_content>/.exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[1]!);
  } catch {
    return null;
  }
}
