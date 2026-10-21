// Utilidades puras de texto para el catálogo.

// "Sesión cerrada ¡ya!" → "sesion-cerrada-ya"
export function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "") || "articulo"
  );
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Teléfonos: 7 o más dígitos con separadores opcionales (incluye el prefijo +999 de la réplica).
const PHONE = /(?:\+?\d[\d\s().-]{6,}\d)/g;
const TICKET = /\bTCK-\d+\b/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Quita datos personales antes de convertir un caso en un artículo del catálogo (§03).
// El admin revisa el borrador antes de publicar: esto es una red de seguridad, no un sustituto.
export function redactPersonalData(text: string, names: string[] = []) {
  let result = text
    .replace(EMAIL, "[correo]")
    .replace(UUID, "[identificador]")
    .replace(TICKET, "[ticket]")
    .replace(PHONE, "[teléfono]");
  const words = names
    .flatMap((name) => name.split(/\s+/))
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
  // Límites de palabra Unicode: \b no reconoce letras acentuadas ("José", "Núñez").
  for (const word of new Set(words))
    result = result.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, "giu"), "[nombre]");
  return result;
}
