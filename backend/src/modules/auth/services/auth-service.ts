import type { Principal } from "../../../shared/auth/authorization-types.js";
import type { AuthAccess, AuthCredentials, AuthRepository, AuthTokens, CurrentAuthAgent, PasswordVerifier } from "./auth-ports.js";

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly access: AuthAccess,
    private readonly tokens: AuthTokens,
    private readonly verifyPassword: PasswordVerifier,
    private readonly dummyHash: string,
    private readonly ttlHours: number,
  ) {}

  async currentAgent(token: string, authenticatedPrincipal?: Principal | null): Promise<CurrentAuthAgent | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const principal = authenticatedPrincipal ?? await this.access.resolvePrincipal(this.tokens.digest(token));
    if (!principal || !await this.access.canReadAccount(principal)) return null;
    const agent = await this.repository.findAgent(principal.accountId);
    if (!agent) return null;
    const agencyName = principal.agencyId ? await this.access.agencyName(principal, principal.agencyId) : null;
    return { ...agent, agency_name: agencyName };
  }

  async login(credentials: AuthCredentials) {
    const user = credentials.usuario.trim().toLowerCase();
    const account = await this.repository.findCredentials(user);
    const validPassword = await this.verifyPassword(credentials.contrasena, account?.password_hash || this.dummyHash);
    if (!validPassword || !account) return { state: "invalid_credentials" as const };
    const token = this.tokens.create();
    await this.repository.replaceSession(account.id, this.tokens.digest(token), this.ttlHours);
    return {
      state: "authenticated" as const,
      token,
      expiresIn: this.ttlHours * 3600,
      agent: await this.currentAgent(token),
    };
  }

  async logout(token: string): Promise<void> {
    if (token) await this.repository.deleteSession(this.tokens.digest(token));
  }
}
