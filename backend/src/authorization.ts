import type { Pool, PoolClient } from "pg";

type Database = Pick<Pool | PoolClient, "query">;

export type AuthorizedClient = {
  document_path: string;
  client_record_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  stage: string | null;
};

export type AuthorizedClientProfile = AuthorizedClient & {
  modified_at: Date | null;
  notes_count: number;
  calls_count: number;
  notes_type: string | null;
  calls_type: string | null;
};

export type Principal = {
  accountId: string;
  role: "agent" | "agency_owner" | "admin";
  agencyId: string | null;
};

export type AuthorizedConversation = {
  id: string;
  owner_account_id: string;
  title: string | null;
  status: "active" | "archived";
  active_client_path: string | null;
  active_client_record_id: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
};

export type AuthorizedAccount = {
  id: string;
  role: string;
  agency_id: string | null;
};

export type AuthorizedAgency = {
  id: string;
  name: string;
  timezone: string | null;
};

export async function resolvePrincipal(
  db: Database,
  tokenHash: string,
): Promise<Principal | null> {
  const { rows } = await db.query(
    `SELECT a.id, a.role, a.agency_id
       FROM reto.sessions AS s
       JOIN onboarding.accounts AS a ON a.id = s.agent_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND a.status = 'active'
        AND a.role IN ('agent', 'agency_owner', 'admin')`,
    [tokenHash],
  );
  const row = rows[0];
  return row
    ? { accountId: row.id, role: row.role, agencyId: row.agency_id }
    : null;
}

/** Resource queries scope by the authenticated principal before returning rows. */
async function queryAuthorizedConversation(
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

export async function withAuthenticatedTransaction<T>(
  pool: Pool,
  tokenHash: string,
  operation: (client: PoolClient, principal: Principal) => Promise<T>,
): Promise<{ authenticated: false } | { authenticated: true; result: T }> {
  const client = await pool.connect();
  let transactionStarted = false;
  let releaseError: Error | undefined;
  try {
    await client.query("BEGIN");
    transactionStarted = true;
    const principal = await resolvePrincipal(client, tokenHash);
    if (!principal) {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return { authenticated: false };
    }

    const result = await operation(client, principal);
    await client.query("COMMIT");
    transactionStarted = false;
    return { authenticated: true, result };
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        releaseError =
          rollbackError instanceof Error
            ? rollbackError
            : new Error("Failed to roll back the authorized conversation transaction");
      }
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

export async function withAuthorizedConversationTransaction<T>(
  pool: Pool,
  tokenHash: string,
  conversationId: string,
  mutate: (
    client: PoolClient,
    conversation: AuthorizedConversation,
    principal: Principal,
  ) => Promise<T>,
): Promise<
  | { authenticated: false }
  | { authenticated: true; authorized: false }
  | { authenticated: true; authorized: true; result: T }
> {
  const transaction = await withAuthenticatedTransaction(
    pool,
    tokenHash,
    async (client, principal) => {
      const conversation = await queryAuthorizedConversation(
        client,
        principal,
        conversationId,
        true,
      );
      if (!conversation) return { authorized: false } as const;
      return {
        authorized: true,
        result: await mutate(client, conversation, principal),
      } as const;
    },
  );
  if (!transaction.authenticated) return { authenticated: false };
  if (!transaction.result.authorized)
    return { authenticated: true, authorized: false };
  return {
    authenticated: true,
    authorized: true,
    result: transaction.result.result,
  };
}

export async function withOwnedConversationTransaction<T>(
  pool: Pool,
  tokenHash: string,
  conversationId: string,
  operation: (
    client: PoolClient,
    principal: Principal,
    conversation: AuthorizedConversation,
  ) => Promise<T>,
): Promise<
  | { authenticated: false }
  | { authenticated: true; authorized: false }
  | { authenticated: true; authorized: true; result: T }
> {
  const transaction = await withAuthenticatedTransaction(
    pool,
    tokenHash,
    async (client, principal) => {
      const { rows } = await client.query(
        `SELECT id, owner_account_id, title, status, active_client_path,
                active_client_record_id, created_at, updated_at, archived_at
           FROM reto.chat_conversations
          WHERE id = $1 AND owner_account_id = $2
          FOR UPDATE`,
        [conversationId, principal.accountId],
      );
      const conversation = rows[0] as AuthorizedConversation | undefined;
      if (!conversation) return { authorized: false } as const;
      return {
        authorized: true,
        result: await operation(client, principal, conversation),
      } as const;
    },
  );
  if (!transaction.authenticated) return { authenticated: false };
  if (!transaction.result.authorized)
    return { authenticated: true, authorized: false };
  return {
    authenticated: true,
    authorized: true,
    result: transaction.result.result,
  };
}

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

export async function listAuthorizedConversations(
  db: Database,
  principal: Principal,
): Promise<AuthorizedConversation[]> {
  const { rows } = await db.query(
    `SELECT c.id, c.owner_account_id, c.title, c.status,
            c.active_client_path, c.active_client_record_id,
            c.created_at, c.updated_at, c.archived_at
       FROM reto.chat_conversations AS c
      WHERE c.owner_account_id = $1
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
    [principal.accountId, principal.role, principal.agencyId],
  );
  return rows;
}

export async function getAuthorizedAccount(
  db: Database,
  principal: Principal,
  accountId: string,
): Promise<AuthorizedAccount | null> {
  const { rows } = await db.query(
    `SELECT a.id, a.role, a.agency_id
       FROM onboarding.accounts AS a
      WHERE a.id = $1
        AND a.status = 'active'
        AND (
          a.id = $2
          OR $3 = 'admin'
          OR ($3 = 'agency_owner' AND a.agency_id = $4)
        )`,
    [accountId, principal.accountId, principal.role, principal.agencyId],
  );
  return rows[0] ?? null;
}

export async function getAuthorizedAgency(
  db: Database,
  principal: Principal,
  agencyId: string,
): Promise<AuthorizedAgency | null> {
  const { rows } = await db.query(
    `SELECT g.id, g.name, g.timezone
       FROM onboarding.agencies AS g
      WHERE g.id = $1
        AND ($2 = 'admin' OR g.id = $3)`,
    [agencyId, principal.role, principal.agencyId],
  );
  return rows[0] ?? null;
}

