import type { PoolClient } from "pg";
import {
  getAuthorizedClientProfile,
  type AuthorizedConversation,
  type Principal,
} from "./authorization.js";

export type AssistantEvidence = {
  state: "ready";
  client: { id: string; document_path: string; name: string | null; email: string | null; phone: string | null; stage: string | null; modified_at: Date | null };
  profileSource: { table: string; record_id: string; client_record_id: string };
  quotes: Array<{ id: string; carrier: string | null; product: string | null; face_amount_cents: string | null; monthly_premium_cents: string | null; annual_premium_cents: string | null; recorded_at: Date | null; source: { table: string; record_id: string } }>;
  missing: string[];
};

export type AssistantEvidenceResult = AssistantEvidence | { state: "client_not_selected" | "not_found" };

export interface AssistantEvidenceRepository {
  load(client: PoolClient, conversation: AuthorizedConversation, principal: Principal): Promise<AssistantEvidenceResult>;
}

/** Reads only profile and quote evidence already scoped to the authenticated principal. */
export class PostgresAssistantEvidenceRepository implements AssistantEvidenceRepository {
  async load(
    client: PoolClient,
    conversation: AuthorizedConversation,
    principal: Principal,
  ): Promise<AssistantEvidenceResult> {
    if (!conversation.active_client_path || !conversation.active_client_record_id)
      return { state: "client_not_selected" };
    const profile = await getAuthorizedClientProfile(
      client,
      principal,
      conversation.active_client_path,
      conversation.active_client_record_id,
    );
    if (!profile) return { state: "not_found" };

    const { rows } = await client.query(
      `WITH scoped_lead AS (
         SELECT owner.id AS owner_id, lead->>'id' AS client_record_id,
                count(*) OVER () AS matching_lead_count
           FROM public.pbg_state_documents AS d
           JOIN onboarding.accounts AS owner ON owner.id = d.document->>'ownerKey'
            AND owner.status = 'active' AND owner.role IN ('agent', 'agency_owner')
           CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(d.document->'leads') = 'array' THEN d.document->'leads' ELSE '[]'::jsonb END) AS lead
          WHERE d.path = $1 AND d.path LIKE 'leads-store/books/%'
            AND jsonb_typeof(d.document) = 'object' AND jsonb_typeof(lead) = 'object'
            AND lead->>'id' = $2
            AND ($3 = 'admin' OR ($3 = 'agent' AND owner.id = $4) OR ($3 = 'agency_owner' AND owner.role = 'agent' AND owner.agency_id = $5))
       )
       SELECT q.quote_id, q.carrier, q.product, q.face_amount_cents,
              q.monthly_premium_cents, q.annual_premium_cents, q.created_at
         FROM scoped_lead AS lead JOIN analytics.quotes AS q
           ON q.lead_id = lead.client_record_id AND q.account_id = lead.owner_id
        WHERE lead.matching_lead_count = 1
        ORDER BY q.created_at DESC NULLS LAST, q.quote_id
        LIMIT 50`,
      [profile.document_path, profile.client_record_id, principal.role, principal.accountId, principal.agencyId],
    );
    const quotes = rows.map((row) => ({
      id: row.quote_id as string,
      carrier: row.carrier as string | null,
      product: row.product as string | null,
      face_amount_cents: row.face_amount_cents as string | null,
      monthly_premium_cents: row.monthly_premium_cents as string | null,
      annual_premium_cents: row.annual_premium_cents as string | null,
      recorded_at: row.created_at as Date | null,
      source: { table: "analytics.quotes", record_id: row.quote_id as string },
    }));
    return {
      state: "ready",
      client: { id: profile.client_record_id, document_path: profile.document_path, name: profile.name, email: profile.email, phone: profile.phone, stage: profile.stage, modified_at: profile.modified_at },
      profileSource: { table: "public.pbg_state_documents", record_id: profile.document_path, client_record_id: profile.client_record_id },
      quotes,
      missing: [
        ...(!quotes.length ? ["No hay cotizaciones con coincidencia exacta de cliente y cuenta."] : []),
        ...(quotes.length === 50 ? ["Contexto limitado a las 50 cotizaciones más recientes; consulta la vista completa de cotizaciones para más registros."] : []),
        "No hay reglas versionadas verificables de elegibilidad, cobertura ni tarifas.",
        "Los importes analíticos no confirman vigencia ni aprobación.",
        ...quotes.flatMap((quote) => [
          ...(!quote.carrier ? [`Cotización ${quote.id}: aseguradora no disponible.`] : []),
          ...(!quote.product ? [`Cotización ${quote.id}: producto no disponible.`] : []),
          ...(quote.face_amount_cents === null ? [`Cotización ${quote.id}: valor nominal no disponible.`] : []),
          ...(quote.monthly_premium_cents === null ? [`Cotización ${quote.id}: prima mensual no disponible.`] : []),
          ...(quote.annual_premium_cents === null ? [`Cotización ${quote.id}: prima anual no disponible.`] : []),
        ]),
      ],
    };
  }
}
