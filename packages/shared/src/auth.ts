import { z } from "zod";

// Contrato del repo base: POST /auth/get-toke recibe usuario y contrasena.
export const loginBodySchema = z.strictObject({
  usuario: z.string().min(1).max(254),
  contrasena: z.string().min(1).max(256),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export const agentSchema = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
  agency_id: z.string().nullable(),
  agency_name: z.string().nullable(),
});

export type Agent = z.infer<typeof agentSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int(),
  agent: agentSchema,
});

export const meResponseSchema = z.object({ agent: agentSchema });

export const isAdmin = (agent: Pick<Agent, "role"> | null | undefined) =>
  agent?.role === "admin";
