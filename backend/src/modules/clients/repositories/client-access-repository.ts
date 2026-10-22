import type { Database, Principal, AuthorizedClient, AuthorizedClientProfile } from "../../../shared/auth/authorization-types.js";

export async function findAuthorizedClient(
  db: Database,
  principal: Principal,
  documentPath: string,
  clientRecordId: string,
): Promise<AuthorizedClient | null> {
  const { rows } = await db.query(
    `SELECT d.path AS document_path,
            lead->>'id' AS client_record_id,
            NULLIF(lead->>'name', '') AS name,
            NULLIF(lead->>'email', '') AS email,
            NULLIF(lead->>'phone', '') AS phone,
            NULLIF(lead->>'stage', '') AS stage
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
      LIMIT 1`,
    [
      documentPath,
      clientRecordId,
      principal.role,
      principal.accountId,
      principal.agencyId,
    ],
  );
  return rows[0] ?? null;
}

export async function searchAuthorizedClients(
  db: Database,
  principal: Principal,
  search: string,
  limit: number,
): Promise<AuthorizedClient[]> {
  const { rows } = await db.query(
    `SELECT d.path AS document_path,
            lead->>'id' AS client_record_id,
            NULLIF(lead->>'name', '') AS name,
            NULLIF(lead->>'email', '') AS email,
            NULLIF(lead->>'phone', '') AS phone,
            NULLIF(lead->>'stage', '') AS stage
       FROM public.pbg_state_documents AS d
       JOIN onboarding.accounts AS owner
         ON owner.id = d.document->>'ownerKey'
        AND owner.status = 'active'
        AND owner.role IN ('agent', 'agency_owner')
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(d.document->'leads') = 'array'
           THEN d.document->'leads' ELSE '[]'::jsonb END
       ) AS lead
      WHERE d.path LIKE 'leads-store/books/%'
        AND jsonb_typeof(d.document) = 'object'
        AND jsonb_typeof(lead) = 'object'
        AND lead->>'id' IS NOT NULL
        AND (
          $1 = 'admin'
          OR ($1 = 'agent' AND owner.id = $2)
          OR ($1 = 'agency_owner' AND owner.role = 'agent'
              AND owner.agency_id = $3)
        )
        AND (
          strpos(lower(COALESCE(lead->>'name', '')), lower($4)) > 0
          OR strpos(lower(COALESCE(lead->>'email', '')), lower($4)) > 0
          OR strpos(lower(COALESCE(lead->>'phone', '')), lower($4)) > 0
          OR strpos(lower(COALESCE(lead->>'id', '')), lower($4)) > 0
        )
      ORDER BY lower(COALESCE(lead->>'name', '')), d.path, lead->>'id'
      LIMIT $5`,
    [principal.role, principal.accountId, principal.agencyId, search, limit],
  );
  return rows;
}

export async function getAuthorizedClientProfile(
  db: Database,
  principal: Principal,
  documentPath: string,
  clientRecordId: string,
): Promise<AuthorizedClientProfile | null> {
  const { rows } = await db.query(
    `SELECT d.path AS document_path,
            lead->>'id' AS client_record_id,
            NULLIF(lead->>'name', '') AS name,
            NULLIF(lead->>'email', '') AS email,
            NULLIF(lead->>'phone', '') AS phone,
            NULLIF(lead->>'stage', '') AS stage,
            d.modified_at,
            CASE WHEN jsonb_typeof(lead->'notes') = 'array'
              THEN jsonb_array_length(lead->'notes') ELSE 0 END AS notes_count,
            CASE WHEN jsonb_typeof(lead->'calls') = 'array'
              THEN jsonb_array_length(lead->'calls') ELSE 0 END AS calls_count,
            jsonb_typeof(lead->'notes') AS notes_type,
            jsonb_typeof(lead->'calls') AS calls_type
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
      LIMIT 1`,
    [
      documentPath,
      clientRecordId,
      principal.role,
      principal.accountId,
      principal.agencyId,
    ],
  );
  return rows[0] ?? null;
}
