import type { Agent } from "../../../shared/types/domain";

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function getCurrentAgent(): Promise<Agent | null> {
  const response = await fetch("/auth/me", { credentials: "same-origin" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("No pudimos conectar. Intenta de nuevo.");
  const result = await response.json() as { agent: Agent };
  return result.agent;
}

export async function signIn(username: string, password: string): Promise<Agent> {
  const response = await fetch("/auth/get-toke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ usuario: username, contrasena: password }),
  });
  const result = await response.json().catch(() => ({})) as { agent?: Agent; message?: string };
  if (!response.ok || !result.agent)
    throw new AuthenticationError(result.message || "No fue posible iniciar sesión.");
  return result.agent;
}

export async function signOut(): Promise<void> {
  const response = await fetch("/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("logout_failed");
}
