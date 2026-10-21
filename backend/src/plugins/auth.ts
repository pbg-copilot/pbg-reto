import fp from "fastify-plugin";
import type { preHandlerAsyncHookHandler } from "fastify";
import type { Agent } from "@reto/shared";
import { forbidden, unauthorized } from "../lib/errors.js";
import { currentAgent } from "../modules/auth/session.js";

declare module "fastify" {
  interface FastifyRequest {
    actor: Agent | null;
  }
  interface FastifyInstance {
    requireAuth: preHandlerAsyncHookHandler;
    requireAdmin: preHandlerAsyncHookHandler;
  }
}

// El rol se lee de la base en cada request; nunca se toma del cliente.
export default fp(async function authPlugin(app) {
  app.decorateRequest("actor", null);

  const requireAuth: preHandlerAsyncHookHandler = async (request) => {
    request.actor ??= await currentAgent(request);
    if (!request.actor) throw unauthorized();
  };

  const requireAdmin: preHandlerAsyncHookHandler = async function (request, reply) {
    await requireAuth.call(this, request, reply);
    if (request.actor?.role !== "admin") throw forbidden();
  };

  app.decorate("requireAuth", requireAuth);
  app.decorate("requireAdmin", requireAdmin);
});
