import type { Database, Principal } from "../../../shared/auth/authorization-types.js";

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
