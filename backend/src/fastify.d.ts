import type { Principal } from "./authorization.js";

declare module "fastify" {
  interface FastifyRequest {
    principal: Principal | null;
  }
}
