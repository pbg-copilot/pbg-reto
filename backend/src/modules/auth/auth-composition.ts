import type { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { checkPassword, hashPassword } from "../../shared/auth/passwords.js";
import { getAuthorizedAccount, getAuthorizedAgency, resolvePrincipal } from "../../shared/auth/authorization.js";
import { PostgresAuthRepository } from "./repositories/auth-repository.js";
import { AuthService } from "./services/auth-service.js";

export async function createAuthService(pool: Pool, digest: (token: string) => string, ttlHours: number): Promise<AuthService> {
  const dummyHash = await hashPassword(randomBytes(24).toString("hex"));
  return new AuthService(
    new PostgresAuthRepository(pool),
    {
      resolvePrincipal: (tokenHash) => resolvePrincipal(pool, tokenHash),
      canReadAccount: async (principal) => Boolean(await getAuthorizedAccount(pool, principal, principal.accountId)),
      agencyName: async (principal, agencyId) => (await getAuthorizedAgency(pool, principal, agencyId))?.name ?? null,
    },
    { create: () => randomBytes(32).toString("base64url"), digest },
    checkPassword, dummyHash, ttlHours,
  );
}
