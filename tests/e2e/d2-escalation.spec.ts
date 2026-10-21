import { expect, test } from "@playwright/test";
import { as, ask, cleanup } from "./helpers";

// D2 (§14): problema desconocido → ticket Abierto con contexto y enlace; un reintento no lo
// duplica. AC-004.6, AC-004.7, AC-002.3 (idempotencia).
test.afterAll(() => cleanup());

// Frases sin artículo en el catálogo de ejemplo (verificado con GET /support/articles?q=…).
// La búsqueda une palabras con OR: una frase con «pantalla» o «guardar» ya encontraría uno.
const UNKNOWN = "El certificado de comisiones del trimestre sale con los montos en cero";

test("D2 · unknown problem: the assistant asks once, then creates an open ticket with context", async ({ browser }) => {
  const page = await as(browser, "requester");
  await page.goto("/soporte");
  await ask(page, UNKNOWN);
  // Sin artículo aplicable: primero una pregunta útil (como máximo dos).
  await expect(page.getByText(/en qué pantalla ocurre/i)).toBeVisible();
  await ask(page, "Afecta los montos de octubre y septiembre");

  const card = page.getByTestId("ticket-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/TCK-\d{6}/);
  await expect(card.getByText("Abierto")).toBeVisible();
  const number = (await card.textContent())!.match(/TCK-\d{6}/)![0];

  // El ticket tiene el reporte original, el resumen del asistente y el origen.
  await card.getByRole("link", { name: "Abrir ticket" }).click();
  await expect(page.getByText("Reporte original", { exact: true })).toBeVisible();
  await expect(page.getByText(UNKNOWN).first()).toBeVisible();
  await expect(page.getByText("Resumen del asistente (IA)")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver la conversación con el asistente" })).toBeVisible();

  // Recargar la conversación no crea otro ticket.
  await page.goBack();
  await page.reload();
  await expect(page.getByTestId("ticket-card")).toHaveCount(1);
  const list = await (await page.request.get(`/api/tickets?q=${encodeURIComponent(number)}`)).json();
  expect(list.total).toBe(1);
});

test("D2 · a retried message (lost response) reuses the same Idempotency-Key and does not duplicate", async ({ browser }) => {
  const page = await as(browser, "requester");
  const conversation = await (await page.request.post("/api/support/conversations", { headers: { "idempotency-key": `d2-conv-${Date.now()}` } })).json();
  const key = `d2-msg-${Date.now()}`;
  const send = (text: string, idempotencyKey: string) =>
    page.request.post(`/api/support/conversations/${conversation.id}/messages`, { headers: { "idempotency-key": idempotencyKey }, data: { text } });

  await send(UNKNOWN, `${key}-1`);
  // El segundo mensaje crea el ticket; el reintento con la misma clave devuelve lo mismo.
  const first = await (await send("Lo noté el lunes con varios colegas", `${key}-2`)).json();
  const retry = await (await send("Lo noté el lunes con varios colegas", `${key}-2`)).json();
  expect(first.conversation.ticket?.display_number).toMatch(/TCK-\d{6}/);
  expect(retry.conversation.ticket.id).toBe(first.conversation.ticket.id);

  const messages = (await (await page.request.get(`/api/support/conversations/${conversation.id}`)).json()).messages;
  expect(messages.filter((m: { role: string; text: string }) => m.role === "user" && m.text === "Lo noté el lunes con varios colegas")).toHaveLength(1);
});
