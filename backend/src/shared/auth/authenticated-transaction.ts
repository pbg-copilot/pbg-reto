import type { Pool, PoolClient } from "pg";
import type { Database, Principal } from "./authorization-types.js";

export type PrincipalResolver = (db: Database, tokenHash: string) => Promise<Principal | null>;

export function createAuthenticatedTransactionRunner(resolvePrincipal: PrincipalResolver) {
  return async function withAuthenticatedTransaction<T>(
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
  };
}

export type AuthenticatedTransactionRunner = ReturnType<typeof createAuthenticatedTransactionRunner>;
