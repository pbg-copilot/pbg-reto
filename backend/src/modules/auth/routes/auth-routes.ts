import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import type { AuthCredentials } from "../services/auth-ports.js";
import { createAuthService } from "../auth-composition.js";

type AuthRouteDependencies = RouteDependencies & { ttlHours: number; allowedOrigin: string };

export async function registerAuthRoutes(
  app: FastifyInstance,
  { pool, digest, tokenOf, ttlHours, allowedOrigin }: AuthRouteDependencies,
): Promise<void> {
  const auth = await createAuthService(pool, digest, ttlHours);
  app.post<{ Body: AuthCredentials }>(
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
      const result = await auth.login(req.body);
      if (result.state === "invalid_credentials")
        return reply.code(401).send({
          error: "invalid_credentials",
          message: "Usuario o contraseña incorrectos.",
        });
      reply.setCookie("reto_session", result.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: allowedOrigin.startsWith("https:"),
        path: "/",
        maxAge: result.expiresIn,
      });
      return { token: result.token, token_type: "Bearer", expires_in: result.expiresIn, agent: result.agent };
    },
  );
  app.get("/auth/me", async (req, reply) => {
    const agent = await auth.currentAgent(tokenOf(req), req.principal);
    if (!agent)
      return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
    return { agent };
  });
  app.post("/auth/logout", async (req, reply) => {
    await auth.logout(tokenOf(req));
    reply.clearCookie("reto_session", { path: "/" });
    return reply.code(204).send();
  });
}
