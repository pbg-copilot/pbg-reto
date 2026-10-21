import { sql, type RawBuilder } from "kysely";

// Búsqueda del catálogo: full-text en español sin acentos (pesos: título y síntomas > etiquetas
// > solución) con OR entre palabras para no perder resultados, más similitud por trigramas en
// el título para tolerar errores de tipeo ("inciar sesion").

export const orQuery = (q: string) =>
  q
    .replace(/["'()&|!:<>*]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" or ");

export function searchCondition(q: string): RawBuilder<boolean> {
  const tsq = sql`websearch_to_tsquery('spanish', helpdesk.immutable_unaccent(${orQuery(q)}))`;
  return sql<boolean>`(v.search_vector @@ ${tsq} OR helpdesk.immutable_unaccent(${q}) <% helpdesk.immutable_unaccent(v.title))`;
}

export function searchRank(q: string): RawBuilder<number> {
  const tsq = sql`websearch_to_tsquery('spanish', helpdesk.immutable_unaccent(${orQuery(q)}))`;
  // ts_rank_cd con normalización 32 (rank / (rank + 1)) queda entre 0 y 1 y no premia repetir términos;
  // la similitud con el título pesa más porque el título resume el problema.
  return sql<number>`(ts_rank_cd(v.search_vector, ${tsq}, 32) + 1.5 * word_similarity(helpdesk.immutable_unaccent(${q}), helpdesk.immutable_unaccent(v.title)))`;
}
