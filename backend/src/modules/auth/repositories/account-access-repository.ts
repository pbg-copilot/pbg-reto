import type { Database, Principal, AuthorizedAccount, AuthorizedAgency } from "../../../shared/auth/authorization-types.js";

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
