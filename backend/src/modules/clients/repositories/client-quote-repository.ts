import type { Database, Principal } from "../../../shared/auth/authorization-types.js";
import { getAuthorizedClientProfile } from "./client-access-repository.js";
import type { ClientQuoteRepository, ClientQuoteScope, ClientQuoteRow } from "../services/client-quote-ports.js";

export class PostgresClientQuoteRepository implements ClientQuoteRepository {
  findProfile(db: Database, principal: Principal, documentPath: string, clientRecordId: string) {
    return getAuthorizedClientProfile(db, principal, documentPath, clientRecordId);
  }

  async listQuotes(db: Database, principal: Principal, profile: ClientQuoteScope) {
    const { rows } = await db.query<ClientQuoteRow>(
      `WITH scoped_lead AS (
         SELECT owner.id AS owner_id, lead->>'id' AS client_record_id,
                count(*) OVER () AS matching_lead_count
           FROM public.pbg_state_documents AS d
           JOIN onboarding.accounts AS owner
             ON owner.id = d.document->>'ownerKey'
            AND owner.status = 'active'
            AND owner.role IN ('agent', 'agency_owner')
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(d.document->'leads') = 'array'
               THEN d.document->'leads' ELSE '[]'::jsonb END
           ) AS lead
          WHERE d.path = $1
            AND d.path LIKE 'leads-store/books/%'
            AND jsonb_typeof(d.document) = 'object'
            AND jsonb_typeof(lead) = 'object'
            AND lead->>'id' = $2
            AND (
              $3 = 'admin'
              OR ($3 = 'agent' AND owner.id = $4)
              OR ($3 = 'agency_owner' AND owner.role = 'agent'
                  AND owner.agency_id = $5)
            )
       )
       SELECT q.quote_id, q.carrier, q.product,
              q.face_amount_cents, q.monthly_premium_cents,
              q.annual_premium_cents, q.created_at
         FROM scoped_lead AS lead
         JOIN analytics.quotes AS q
           ON q.lead_id = lead.client_record_id
          AND q.account_id = lead.owner_id
        WHERE lead.matching_lead_count = 1
        ORDER BY q.created_at NULLS LAST, q.quote_id`,
      [
        profile.document_path,
        profile.client_record_id,
        principal.role,
        principal.accountId,
        principal.agencyId,
      ],
    );

    return rows;
  }
}
