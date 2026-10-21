import type { FastifyRequest } from "fastify";
import { digest, tokenOf } from "../modules/auth/session.js";

// El rate limit corre antes de la autenticación: se agrupa por sesión (una por cuenta)
// y, sin sesión, por IP.
const bySession = (request: FastifyRequest) => {
  const token = tokenOf(request);
  return token ? `s:${digest(token)}` : `ip:${request.ip}`;
};

export const mutationRateLimit = { max: 120, timeWindow: "1 minute", keyGenerator: bySession };
export const chatRateLimit = { max: 20, timeWindow: "1 minute", keyGenerator: bySession };
export const uploadRateLimit = { max: 20, timeWindow: "1 minute", keyGenerator: bySession };
