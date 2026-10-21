import type { PoolClient } from "pg";
import type { Principal } from "./authorization.js";

export async function isAuthorizedAppointmentAgent(
  client: PoolClient,
  principal: Principal,
  agentAccountId: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1
       FROM onboarding.accounts
      WHERE id = $1
        AND role = 'agent'
        AND status = 'active'
        AND (
          ($2 = 'agent' AND id = $3)
          OR ($2 = 'agency_owner' AND agency_id = $4)
        )`,
    [agentAccountId, principal.role, principal.accountId, principal.agencyId],
  );
  return rows.length > 0;
}
