import type { Principal } from "../auth/authorization.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}
