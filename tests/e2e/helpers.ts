import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, type Browser, type Page } from "@playwright/test";

// Cuentas reservadas para tests (specs/README.md). Nunca las de la demo manual.
export const ACCOUNTS = {
  requester: "agente048",
  // Dueño de la agencia de agente048: compartir agencia no da acceso (D5).
  agencyOwner: "agente049",
  admin: "agente015",
  secondAdmin: "agente104",
} as const;
type Role = keyof typeof ACCOUNTS;

export const authFile = (username: string) => fileURLToPath(new URL(`./.auth/${username}.json`, import.meta.url));

// 1×1 PNG real para las evidencias.
export const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d9a2fc0000000049454e44ae426082",
  "hex",
);

// Prefijo único por corrida: la limpieza borra solo lo que creó esta corrida.
export const RUN = `E2E-${Date.now().toString(36)}`;

export async function as(browser: Browser, role: Role): Promise<Page> {
  const context = await browser.newContext({ storageState: authFile(ACCOUNTS[role]) });
  return context.newPage();
}

type TicketInput = { title: string; description?: string; category?: string; impact?: "low" | "medium" | "high" | "critical" };
export type CreatedTicket = { id: string; display_number: string; version: number };

// Preparar datos por la API (más rápido que la UI y con la misma sesión de la página).
export async function createTicket(page: Page, input: TicketInput): Promise<CreatedTicket> {
  const res = await page.request.post("/api/tickets", {
    headers: { "idempotency-key": `${RUN}-${Math.random().toString(36).slice(2)}` },
    data: { description: "El reporte de ventas no se exporta y aparece un error.", category: "screens", impact: "medium", ...input },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

export async function ticket(page: Page, id: string) {
  const res = await page.request.get(`/api/tickets/${id}`);
  return { status: res.status(), body: res.ok() ? await res.json() : null };
}

export async function ask(page: Page, text: string) {
  await page.getByLabel("Mensaje para el asistente").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
}

// Buzón local (Mailpit): búsqueda por asunto.
export async function mailpitCount(subject: string) {
  const res = await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`);
  const body = (await res.json()) as { messages_count: number };
  return body.messages_count;
}

export const compose = (...args: string[]) => execFileSync("docker", ["compose", ...args], { stdio: "pipe" }).toString();

export function sql(statement: string) {
  return compose("exec", "-T", "postgres", "psql", "-U", "reto", "-d", "reto", "-qAtc", statement).trim();
}

// Lo que crearon las cuentas de test desde que empezó la corrida (tickets con sus notificaciones
// y adjuntos, y conversaciones). Son cuentas reservadas para tests: no se toca nada de la demo.
const STARTED = new Date(Date.now() - 1000).toISOString();
export function cleanup() {
  const accounts = `(SELECT id FROM reto.agents WHERE username IN (${Object.values(ACCOUNTS).map((u) => `'${u}'`).join(",")}))`;
  sql(
    `DELETE FROM helpdesk.tickets WHERE requester_id IN ${accounts} AND created_at >= '${STARTED}';` +
      `DELETE FROM helpdesk.conversations WHERE requester_id IN ${accounts} AND created_at >= '${STARTED}';`,
  );
}
