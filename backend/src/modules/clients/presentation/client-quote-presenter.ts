import type { LoadedClientQuotes } from "../services/client-quote-service.js";

export function presentClientQuotes(result: LoadedClientQuotes) {
  return {
    client_record_id: result.clientRecordId,
    quotes_status: result.quotes.length ? "loaded" : "empty",
    quotes: result.quotes,
    comparison_status:
      result.quotes.length > 1
        ? "observed_fields_only"
        : result.quotes.length === 1
          ? "single_record"
          : "empty",
    comparison: {
      quote_ids: result.quotes.map((quote) => quote.id),
      records: result.quotes.map((quote) => ({
        quote_id: quote.id,
        carrier: quote.carrier,
        product: quote.product,
        face_amount_cents: quote.face_amount_cents,
        monthly_premium_cents: quote.monthly_premium_cents,
        annual_premium_cents: quote.annual_premium_cents,
        recorded_at: quote.recorded_at,
        source_record_id: quote.source.record_id,
      })),
      fields: [
        "carrier",
        "product",
        "face_amount_cents",
        "monthly_premium_cents",
        "annual_premium_cents",
        "recorded_at",
      ],
      interpretation: "stored_values_only",
    },
    rules: {
      status: "unavailable",
      version: null,
      reason: "No se encontró un catálogo de reglas versionado en el respaldo.",
    },
    record_semantics: {
      kind: "analytics_snapshot",
      meaning:
        "Valores registrados en analytics.quotes asociados por coincidencia exacta de IDs; no representan por sí solos una oferta vigente, aprobada o emitida.",
      fields: {
        face_amount_cents:
          "Valor nominal almacenado; no confirma cobertura contratada.",
        monthly_premium_cents:
          "Importe mensual almacenado; no confirma tarifa vigente.",
        annual_premium_cents:
          "Importe anual almacenado; no confirma tarifa vigente.",
        recorded_at:
          "Fecha de registro analítico; no es fecha de emisión o vigencia.",
      },
    },
    source: {
      table: "analytics.quotes",
      relationship_status: "exact_key_match_association_only",
    },
    missing: result.missing,
  };
}
