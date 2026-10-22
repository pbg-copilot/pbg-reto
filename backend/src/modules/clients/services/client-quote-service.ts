import type { AuthorizedConversation, Database, Principal } from "../../../shared/auth/authorization-types.js";
import type { ClientQuoteRepository } from "./client-quote-ports.js";

export class ClientQuoteService {
  constructor(private readonly repository: ClientQuoteRepository) {}

  async load(db: Database, conversation: AuthorizedConversation, principal: Principal) {
    if (!conversation.active_client_path || !conversation.active_client_record_id)
      return { state: "client_not_selected" as const };
    const profile = await this.repository.findProfile(
      db, principal, conversation.active_client_path, conversation.active_client_record_id,
    );
    if (!profile) return { state: "not_found" as const };
    const rows = await this.repository.listQuotes(db, principal, profile);
    const quotes = rows.map((quote) => ({
      id: quote.quote_id,
      carrier: quote.carrier,
      product: quote.product,
      face_amount_cents: quote.face_amount_cents,
      monthly_premium_cents: quote.monthly_premium_cents,
      annual_premium_cents: quote.annual_premium_cents,
      recorded_at: quote.created_at,
      source: {
        type: "analytics_quote_snapshot",
        table: "analytics.quotes",
        record_id: quote.quote_id,
        client_record_id: profile.client_record_id,
        date: quote.created_at,
        match_basis: "exact_lead_id_and_owner_account_id",
      },
    }));
    const missing = [
      ...(!quotes.length
        ? ["no hay registros con coincidencia exacta de lead_id y account_id"]
        : []),
      "reglas versionadas de elegibilidad, cobertura y tarifas",
      "confirmación de vigencia y aprobación de los importes analíticos",
    ];
    for (const quote of quotes) {
      if (!quote.carrier) missing.push(`cotización ${quote.id}: carrier`);
      if (!quote.product) missing.push(`cotización ${quote.id}: product`);
      if (quote.face_amount_cents === null)
        missing.push(`cotización ${quote.id}: face_amount_cents`);
      if (quote.monthly_premium_cents === null)
        missing.push(`cotización ${quote.id}: monthly_premium_cents`);
      if (quote.annual_premium_cents === null)
        missing.push(`cotización ${quote.id}: annual_premium_cents`);
    }
    return {
      state: "loaded" as const,
      clientRecordId: conversation.active_client_record_id,
      quotes,
      missing,
    };
  }
}

export type LoadedClientQuotes = Extract<Awaited<ReturnType<ClientQuoteService["load"]>>, { state: "loaded" }>;
