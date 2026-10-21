import type { Pool, PoolClient } from "pg";

type Database = Pick<Pool | PoolClient, "query">;

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
export async function getAuthorizedConversation(
  db: Database,
  principal: Principal,
  conversationId: string,
  lock = false,
): Promise<AuthorizedConversation | null> {
  const { rows } = await db.query(
    `SELECT c.id, c.owner_account_id, c.title, c.status,
            c.active_client_path, c.active_client_record_id,
            c.created_at, c.updated_at, c.archived_at
       FROM reto.chat_conversations AS c
      WHERE c.id = $1
        AND c.owner_account_id = $2
        AND c.active_client_path IS NULL
        AND c.active_client_record_id IS NULL
      ${lock ? "FOR UPDATE" : ""}`,
    [conversationId, principal.accountId],
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
        AND c.active_client_path IS NULL
        AND c.active_client_record_id IS NULL
      ORDER BY c.updated_at DESC, c.id`,
    [principal.accountId],
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

