import type { Pool } from "pg";
import type { AuthAccountCredentials, AuthAgent, AuthRepository } from "../services/auth-ports.js";

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly pool: Pool) {}

  async findCredentials(user: string): Promise<AuthAccountCredentials | undefined> {
    const { rows } = await this.pool.query<AuthAccountCredentials>(
      "SELECT a.id,a.password_hash FROM reto.agents a JOIN onboarding.accounts account ON account.id=a.id WHERE (a.username=$1 OR a.email=$1) AND account.status='active' AND account.role IN ('agent','agency_owner','admin')",
      [user],
    );
    return rows[0];
  }

  async findAgent(accountId: string): Promise<AuthAgent | null> {
    const { rows } = await this.pool.query<AuthAgent>(
      "SELECT a.id,a.username,a.email,a.name,a.role,a.agency_id FROM reto.agents a WHERE a.id=$1",
      [accountId],
    );
    return rows[0] ?? null;
  }

  async replaceSession(accountId: string, tokenHash: string, ttlHours: number): Promise<void> {
    const conn = await this.pool.connect();
    try {
      await conn.query("BEGIN");
      await conn.query("SELECT id FROM onboarding.accounts WHERE id=$1 FOR UPDATE", [accountId]);
      await conn.query("DELETE FROM reto.sessions WHERE agent_id=$1", [accountId]);
      await conn.query(
        "INSERT INTO reto.sessions(token_hash,agent_id,expires_at) VALUES($1,$2,now()+($3::text||' hours')::interval)",
        [tokenHash, accountId, ttlHours],
      );
      await conn.query("COMMIT");
    } catch (error) {
      await conn.query("ROLLBACK");
      throw error;
    } finally {
      conn.release();
    }
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM reto.sessions WHERE token_hash=$1", [tokenHash]);
  }
}
