import type { Principal } from "../../../shared/auth/authorization-types.js";

export type AuthCredentials = { usuario: string; contrasena: string };

export type AuthAccountCredentials = { id: string; password_hash: string | null };

export type AuthAgent = {
  id: string;
  username: string;
  email: string;
  name: string;
  role: string;
  agency_id: string | null;
};

export type CurrentAuthAgent = AuthAgent & { agency_name: string | null };

export interface AuthRepository {
  findCredentials(user: string): Promise<AuthAccountCredentials | undefined>;
  findAgent(accountId: string): Promise<AuthAgent | null>;
  replaceSession(accountId: string, tokenHash: string, ttlHours: number): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
}

export interface AuthAccess {
  resolvePrincipal(tokenHash: string): Promise<Principal | null>;
  canReadAccount(principal: Principal): Promise<boolean>;
  agencyName(principal: Principal, agencyId: string): Promise<string | null>;
}

export interface AuthTokens {
  create(): string;
  digest(token: string): string;
}

export type PasswordVerifier = (password: string, encoded: string) => Promise<boolean>;
