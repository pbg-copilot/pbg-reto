import type { Database, Principal, AuthorizedConversation } from "../../../shared/auth/authorization-types.js";

/** Resource queries scope by the authenticated principal before returning rows. */
export async function queryAuthorizedConversation(
  db: Database,
  principal: Principal,
  conversationId: string,
  lock: boolean,
): Promise<AuthorizedConversation | null> {
  const { rows } = await db.query(
    `SELECT c.id, c.owner_account_id, c.title, c.status,
            c.active_client_path, c.active_client_record_id,
            c.created_at, c.updated_at, c.archived_at
       FROM reto.chat_conversations AS c
      WHERE c.id = $1
        AND c.owner_account_id = $2
        AND (
          (c.active_client_path IS NULL AND c.active_client_record_id IS NULL)
          OR EXISTS (
            SELECT 1
              FROM public.pbg_state_documents AS d
              JOIN onboarding.accounts AS owner
                ON owner.id = d.document->>'ownerKey'
               AND owner.status = 'active'
               AND owner.role IN ('agent', 'agency_owner')
              CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(d.document->'leads') = 'array'
                  THEN d.document->'leads' ELSE '[]'::jsonb END
              ) AS lead
             WHERE d.path = c.active_client_path
               AND d.path LIKE 'leads-store/books/%'
               AND jsonb_typeof(d.document) = 'object'
               AND lead->>'id' = c.active_client_record_id
               AND jsonb_typeof(lead) = 'object'
               AND (
                 $3 = 'admin'
                 OR ($3 = 'agent' AND owner.id = $2)
                 OR ($3 = 'agency_owner' AND owner.role = 'agent'
                     AND owner.agency_id = $4)
               )
          )
        )
      ${lock ? "FOR UPDATE" : ""}`,
    [conversationId, principal.accountId, principal.role, principal.agencyId],
  );
  return rows[0] ?? null;
}

export function getAuthorizedConversation(
  db: Database,
  principal: Principal,
  conversationId: string,
): Promise<AuthorizedConversation | null> {
  return queryAuthorizedConversation(db, principal, conversationId, false);
}

export async function listAuthorizedConversations(
  db: Database,
  principal: Principal,
  search?: string,
): Promise<AuthorizedConversation[]> {
  const { rows } = await db.query(
    `SELECT c.id, c.owner_account_id, c.title, c.status,
            c.active_client_path, c.active_client_record_id,
            c.created_at, c.updated_at, c.archived_at
       FROM reto.chat_conversations AS c
      WHERE c.owner_account_id = $1
        AND (
          $4::text IS NULL
          OR strpos(lower(COALESCE(c.title, '')), lower($4::text)) > 0
          OR EXISTS (
            SELECT 1
              FROM public.pbg_state_documents AS search_doc
              JOIN onboarding.accounts AS search_owner
                ON search_owner.id = search_doc.document->>'ownerKey'
               AND search_owner.status = 'active'
               AND search_owner.role IN ('agent', 'agency_owner')
              CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(search_doc.document->'leads') = 'array'
                  THEN search_doc.document->'leads' ELSE '[]'::jsonb END
              ) AS search_lead
             WHERE search_doc.path = c.active_client_path
               AND search_doc.path LIKE 'leads-store/books/%'
               AND jsonb_typeof(search_doc.document) = 'object'
               AND jsonb_typeof(search_lead) = 'object'
               AND search_lead->>'id' = c.active_client_record_id
               AND (
                 $2 = 'admin'
                 OR ($2 = 'agent' AND search_owner.id = $1)
                 OR ($2 = 'agency_owner' AND search_owner.role = 'agent'
                     AND search_owner.agency_id = $3)
               )
               AND (
                 strpos(lower(COALESCE(search_lead->>'name', '')), lower($4::text)) > 0
                 OR strpos(lower(COALESCE(search_lead->>'email', '')), lower($4::text)) > 0
                 OR strpos(lower(COALESCE(search_lead->>'phone', '')), lower($4::text)) > 0
               )
          )
          OR EXISTS (
            SELECT 1
              FROM reto.chat_messages AS search_message
              LEFT JOIN LATERAL (
                SELECT action.entity_id
                  FROM reto.chat_actions AS action
                 WHERE action.conversation_id = search_message.conversation_id
                   AND action.action_type IN ('client.selected', 'client.changed')
                   AND action.outcome = 'succeeded'
                   AND action.occurred_at <= search_message.created_at
                 ORDER BY action.occurred_at DESC, action.id DESC
                 LIMIT 1
              ) AS search_context ON true
             WHERE search_message.conversation_id = c.id
               AND (
                 (c.active_client_path IS NULL
                  AND c.active_client_record_id IS NULL
                  AND search_message.client_document_path IS NULL
                  AND search_message.client_record_id IS NULL
                  AND search_context.entity_id IS NULL)
                 OR
                 (c.active_client_path IS NOT NULL
                  AND c.active_client_record_id IS NOT NULL
                  AND (
                    (search_message.client_document_path = c.active_client_path
                     AND search_message.client_record_id = c.active_client_record_id)
                    OR (search_message.client_document_path IS NULL
                        AND search_message.client_record_id IS NULL
                        AND search_context.entity_id = c.active_client_path || '#' || c.active_client_record_id)
                  ))
               )
               AND strpos(lower(search_message.content), lower($4::text)) > 0
          )
        )
        AND (
          (c.active_client_path IS NULL AND c.active_client_record_id IS NULL)
          OR EXISTS (
            SELECT 1
              FROM public.pbg_state_documents AS d
              JOIN onboarding.accounts AS owner
                ON owner.id = d.document->>'ownerKey'
               AND owner.status = 'active'
               AND owner.role IN ('agent', 'agency_owner')
              CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(d.document->'leads') = 'array'
                  THEN d.document->'leads' ELSE '[]'::jsonb END
              ) AS lead
             WHERE d.path = c.active_client_path
               AND d.path LIKE 'leads-store/books/%'
               AND jsonb_typeof(d.document) = 'object'
               AND jsonb_typeof(lead) = 'object'
               AND lead->>'id' = c.active_client_record_id
               AND (
                 $2 = 'admin'
                 OR ($2 = 'agent' AND owner.id = $1)
                 OR ($2 = 'agency_owner' AND owner.role = 'agent'
                     AND owner.agency_id = $3)
               )
          )
        )
      ORDER BY c.updated_at DESC, c.id`,
    [principal.accountId, principal.role, principal.agencyId, search ?? null],
  );
  return rows;
}

export async function lockOwnedConversation(
  db: Database, principal: Principal, conversationId: string,
): Promise<AuthorizedConversation | null> {
  const { rows } = await db.query(
    `SELECT id, owner_account_id, title, status, active_client_path,
                active_client_record_id, created_at, updated_at, archived_at
           FROM reto.chat_conversations
          WHERE id = $1 AND owner_account_id = $2
          FOR UPDATE`,
    [conversationId, principal.accountId],
  );
  return rows[0] ?? null;
}
