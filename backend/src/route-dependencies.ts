import type { Pool } from "pg";
import type { FastifyRequest } from "fastify";

export type RouteDependencies = {
  pool: Pool;
  digest: (token: string) => string;
  tokenOf: (request: FastifyRequest) => string;
};
