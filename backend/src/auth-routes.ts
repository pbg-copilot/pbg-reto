import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { checkPassword, hashPassword } from "./passwords.js";
import {
  getAuthorizedAccount,
  getAuthorizedAgency,
  resolvePrincipal,
  type Principal,
} from "./authorization.js";
import type { RouteDependencies } from "./route-dependencies.js";

type AuthRouteDependencies = RouteDependencies & { ttlHours: number; allowedOrigin: string };

export async function registerAuthRoutes(
  app: FastifyInstance,
  { pool, digest, tokenOf, ttlHours, allowedOrigin }: AuthRouteDependencies,
): Promise<void> {
  const dummyHash = await hashPassword(randomBytes(24).toString("hex"));
  async function currentAgent(
    token: string,
    authenticatedPrincipal?: Principal | null,
  ) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const principal =
      authenticatedPrincipal ?? (await resolvePrincipal(pool, digest(token)));
    if (!principal) return null;
    const account = await getAuthorizedAccount(
      pool,
      principal,
      principal.accountId,
    );
    if (!account) return null;
    const { rows } = await pool.query(
      "SELECT a.id,a.username,a.email,a.name,a.role,a.agency_id FROM reto.agents a WHERE a.id=$1",
      [principal.accountId],
    );
    if (!rows[0]) return null;
    const agency = principal.agencyId
      ? await getAuthorizedAgency(pool, principal, principal.agencyId)
      : null;
    return { ...rows[0], agency_name: agency?.name ?? null };
  }
  app.post<{ Body: { usuario: string; contrasena: string } }>(
    "/auth/get-toke",
    {
      config: { rateLimit: { max: 15, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["usuario", "contrasena"],
          properties: {
            usuario: { type: "string", minLength: 1, maxLength: 254 },
            contrasena: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.body.usuario.trim().toLowerCase();
      const found = await pool.query(
        "SELECT a.id,a.password_hash FROM reto.agents a JOIN onboarding.accounts account ON account.id=a.id WHERE (a.username=$1 OR a.email=$1) AND account.status='active' AND account.role IN ('agent','agency_owner','admin')",
        [user],
      );
      const account = found.rows[0];
      if (
        !(await checkPassword(
          req.body.contrasena,
          account?.password_hash || dummyHash,
        )) ||
        !account
      )
        return reply.code(401).send({
          error: "invalid_credentials",
          message: "Usuario o contraseña incorrectos.",
        });
      const token = randomBytes(32).toString("base64url");
      const conn = await pool.connect();
      try {
        await conn.query("BEGIN");
        await conn.query(
          "SELECT id FROM onboarding.accounts WHERE id=$1 FOR UPDATE",
          [account.id],
        );
        await conn.query("DELETE FROM reto.sessions WHERE agent_id=$1", [
          account.id,
        ]);
        await conn.query(
          "INSERT INTO reto.sessions(token_hash,agent_id,expires_at) VALUES($1,$2,now()+($3::text||' hours')::interval)",
          [digest(token), account.id, ttlHours],
        );
        await conn.query("COMMIT");
      } catch (error) {
        await conn.query("ROLLBACK");
        throw error;
      } finally {
        conn.release();
      }
      reply.setCookie("reto_session", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: allowedOrigin.startsWith("https:"),
        path: "/",
        maxAge: ttlHours * 3600,
      });
      return {
        token,
        token_type: "Bearer",
        expires_in: ttlHours * 3600,
      agent: await currentAgent(token),
      };
    },
  );
  app.get("/auth/me", async (req, reply) => {
    const agent = await currentAgent(tokenOf(req), req.principal);
    if (!agent)
      return reply.code(401).send({
        error: "unauthorized",
        message: "Inicia sesión para continuar.",
      });
    return { agent };
  });
  app.post("/auth/logout", async (req, reply) => {
    const token = tokenOf(req);
    if (token)
      await pool.query("DELETE FROM reto.sessions WHERE token_hash=$1", [
        digest(token),
      ]);
    reply.clearCookie("reto_session", { path: "/" });
    return reply.code(204).send();
  });
}
