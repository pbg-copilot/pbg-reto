import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { apiErrorSchema, loginBodySchema, loginResponseSchema, meResponseSchema } from "@reto/shared";
import { pool } from "../../db.js";
import { checkPassword, hashPassword } from "../../passwords.js";
import { AppError, unauthorized } from "../../lib/errors.js";
import { agentForToken, currentAgent, digest, tokenOf } from "./session.js";

type Options = { ttlHours: number; secureCookie: boolean };

// Contrato del repo base: no cambiar rutas, campos ni códigos de estado.
const authRoutes: FastifyPluginAsyncZod<Options> = async (app, { ttlHours, secureCookie }) => {
  const dummyHash = await hashPassword(randomBytes(24).toString("hex"));

  app.post(
    "/auth/get-toke",
    {
      config: { rateLimit: { max: 15, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        summary: "Iniciar sesión",
        description: "Recibe usuario (alias o correo) y contrasena. Devuelve un token opaco y fija la cookie HttpOnly reto_session.",
        body: loginBodySchema,
        response: { 200: loginResponseSchema, 401: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const user = request.body.usuario.trim().toLowerCase();
      const found = await pool.query<{ id: string; password_hash: string }>(
        "SELECT id,password_hash FROM reto.agents WHERE username=$1 OR email=$1",
        [user],
      );
      const account = found.rows[0];
      // Siempre se verifica un hash, exista o no la cuenta, para no filtrar tiempos.
      const valid = await checkPassword(request.body.contrasena, account?.password_hash || dummyHash);
      if (!valid || !account)
        throw new AppError(401, "invalid_credentials", "Usuario o contraseña incorrectos.");
      const token = randomBytes(32).toString("base64url");
      const conn = await pool.connect();
      try {
        await conn.query("BEGIN");
        await conn.query("SELECT id FROM onboarding.accounts WHERE id=$1 FOR UPDATE", [account.id]);
        await conn.query("DELETE FROM reto.sessions WHERE agent_id=$1", [account.id]);
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
        secure: secureCookie,
        path: "/",
        maxAge: ttlHours * 3600,
      });
      const agent = await agentForToken(token);
      if (!agent) throw unauthorized();
      return { token, token_type: "Bearer" as const, expires_in: ttlHours * 3600, agent };
    },
  );

  app.get(
    "/auth/me",
    {
      schema: {
        tags: ["auth"],
        summary: "Sesión actual",
        security: [{ bearer: [] }, { cookie: [] }],
        response: { 200: meResponseSchema, 401: apiErrorSchema },
      },
    },
    async (request) => {
      const agent = await currentAgent(request);
      if (!agent) throw unauthorized();
      return { agent };
    },
  );

  app.post(
    "/auth/logout",
    {
      schema: {
        tags: ["auth"],
        summary: "Cerrar sesión",
        description: "Revoca la sesión y elimina la cookie.",
        response: { 204: z.undefined() },
      },
    },
    async (request, reply) => {
      const token = tokenOf(request);
      if (token) await pool.query("DELETE FROM reto.sessions WHERE token_hash=$1", [digest(token)]);
      reply.clearCookie("reto_session", { path: "/" });
      return reply.code(204).send();
    },
  );
};

export default authRoutes;
