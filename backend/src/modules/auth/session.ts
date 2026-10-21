import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Agent } from "@reto/shared";
import { pool } from "../../db.js";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const digest = (token: string) => createHash("sha256").update(token).digest("hex");

type TokenSource = Pick<FastifyRequest, "headers"> & { cookies?: Record<string, string | undefined> };

export function tokenOf(request: TokenSource): string {
  const authorization = request.headers.authorization;
  if (authorization)
    return /^Bearer [A-Za-z0-9_-]{43}$/.test(authorization) ? authorization.slice(7) : "";
  return request.cookies?.reto_session || "";
}

export async function agentForToken(token: string): Promise<Agent | null> {
  if (!TOKEN.test(token)) return null;
  const { rows } = await pool.query<Agent>(
    "SELECT a.id,a.username,a.email,a.name,a.role,a.agency_id,g.name AS agency_name FROM reto.sessions s JOIN reto.agents a ON a.id=s.agent_id LEFT JOIN reto.agencies g ON g.id=a.agency_id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [digest(token)],
  );
  return rows[0] ?? null;
}

export const currentAgent = (request: TokenSource) => agentForToken(tokenOf(request));
