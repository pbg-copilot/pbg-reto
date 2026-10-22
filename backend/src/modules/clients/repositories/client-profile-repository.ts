import type { Database, Principal } from "../../../shared/auth/authorization-types.js";
import { getAuthorizedClientProfile } from "./client-access-repository.js";
import type { ClientProfileRepository, ClientProfileScope, ClientNoteRow, ClientActivityRow } from "../services/client-profile-ports.js";

export class PostgresClientProfileRepository implements ClientProfileRepository {
  findProfile(db: Database, principal: Principal, documentPath: string, clientRecordId: string) {
    return getAuthorizedClientProfile(db, principal, documentPath, clientRecordId);
  }

  async listNotes(db: Database, principal: Principal, profile: ClientProfileScope, beforeNoteIndex: string | null, limit: number) {
    const { rows } = await db.query<ClientNoteRow>(
      `SELECT note.ordinality::text AS note_index,
              COALESCE(NULLIF(note.value->>'id', ''), note.ordinality::text) AS note_id,
              NULLIF(note.value->>'callId', '') AS call_id,
              note.value->'text' AS text,
              CASE WHEN jsonb_typeof(note.value->'at') = 'number'
                        AND (note.value->>'at')::numeric BETWEEN 0 AND 4102444800000
                THEN to_timestamp((note.value->>'at')::double precision / 1000.0)
                ELSE NULL END AS occurred_at
         FROM public.pbg_state_documents AS d
         JOIN onboarding.accounts AS owner
           ON owner.id = d.document->>'ownerKey'
          AND owner.status = 'active'
          AND owner.role IN ('agent', 'agency_owner')
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(d.document->'leads') = 'array'
             THEN d.document->'leads' ELSE '[]'::jsonb END
         ) AS lead
         CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(lead->'notes') = 'array'
             THEN lead->'notes' ELSE '[]'::jsonb END
         ) WITH ORDINALITY AS note(value, ordinality)
        WHERE d.path = $1
          AND d.path LIKE 'leads-store/books/%'
          AND jsonb_typeof(d.document) = 'object'
          AND jsonb_typeof(lead) = 'object'
          AND lead->>'id' = $2
          AND jsonb_typeof(note.value) = 'object'
          AND (
            jsonb_typeof(note.value->'text') = 'string'
            OR (jsonb_typeof(note.value->'text') = 'object'
                AND (jsonb_typeof(note.value->'text'->'es') = 'string'
                     OR jsonb_typeof(note.value->'text'->'en') = 'string'))
          )
          AND (
            $3 = 'admin'
            OR ($3 = 'agent' AND owner.id = $4)
            OR ($3 = 'agency_owner' AND owner.role = 'agent'
                AND owner.agency_id = $5)
          )
          AND ($6::bigint IS NULL OR note.ordinality < $6::bigint)
        ORDER BY note.ordinality DESC
        LIMIT $7`,
      [
        profile.document_path,
        profile.client_record_id,
        principal.role,
        principal.accountId,
        principal.agencyId,
        beforeNoteIndex,
        limit + 1,
      ],
    );

    return rows;
  }

  async listActivity(db: Database, principal: Principal, profile: ClientProfileScope, beforeActivityIndex: string | null, limit: number) {
    const activityResult = await db.query<ClientActivityRow>(
      `WITH scoped_lead AS (
         SELECT lead
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
       ), eligible AS (
         SELECT note.ordinality,
                COALESCE(NULLIF(note.value->>'id', ''), note.ordinality::text) AS note_id,
                note.value->>'callId' AS call_id,
                CASE WHEN jsonb_typeof(note.value->'at') = 'number'
                           AND (note.value->>'at')::numeric BETWEEN 0 AND 4102444800000
                  THEN to_timestamp((note.value->>'at')::double precision / 1000.0)
                  ELSE NULL END AS occurred_at
           FROM scoped_lead
           CROSS JOIN LATERAL jsonb_array_elements(
             CASE WHEN jsonb_typeof(lead->'notes') = 'array'
               THEN lead->'notes' ELSE '[]'::jsonb END
           ) WITH ORDINALITY AS note(value, ordinality)
          WHERE jsonb_typeof(note.value) = 'object'
            AND NULLIF(note.value->>'callId', '') IS NOT NULL
            AND CASE WHEN jsonb_typeof(note.value->'at') = 'number'
                THEN (note.value->>'at')::numeric BETWEEN 0 AND 4102444800000
                ELSE false END
       ), page AS (
         SELECT * FROM eligible
          WHERE $6::bigint IS NULL OR ordinality < $6::bigint
          ORDER BY ordinality DESC
          LIMIT $7
       )
       SELECT page.ordinality::text AS activity_index,
              page.note_id,
              page.call_id,
              page.occurred_at,
              (SELECT count(*) FROM eligible)::integer AS total_count
         FROM (SELECT 1) AS seed
         LEFT JOIN page ON true
        ORDER BY page.ordinality DESC`,
      [
        profile.document_path,
        profile.client_record_id,
        principal.role,
        principal.accountId,
        principal.agencyId,
        beforeActivityIndex,
        limit + 1,
      ],
    );

    return activityResult.rows;
  }
}
