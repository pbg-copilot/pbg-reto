import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

// Spec 004 en la interfaz. Funciona con el proveedor fake y con Haiku real: las aserciones
// son estructurales (tarjetas, botones, estados), no sobre el texto exacto del modelo.
const sessions = new Map();

async function pageAs(browser, usuario) {
  if (!sessions.has(usuario)) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/");
    await page.getByLabel("Usuario", { exact: true }).fill(usuario);
    await page.getByLabel("Contraseña", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await expect(page.getByTestId("agent-name")).toBeVisible();
    sessions.set(usuario, await context.storageState());
    await context.close();
  }
  const context = await browser.newContext({ storageState: sessions.get(usuario) });
  return context.newPage();
}

async function ask(page, text) {
  await page.getByLabel("Mensaje para el asistente").fill(text);
  await page.getByRole("button", { name: "Enviar" }).click();
}

test.afterAll(() => {
  // Conversaciones y tickets del chat creados por la cuenta de test.
  execFileSync("docker", [
    "compose", "exec", "-T", "postgres", "psql", "-U", "reto", "-d", "reto", "-qc",
    "DELETE FROM helpdesk.tickets WHERE source IN ('assistant','human_request') AND requester_id IN (SELECT id FROM reto.agents WHERE username IN ('agente048','agente002')); " +
      "DELETE FROM helpdesk.conversations WHERE requester_id IN (SELECT id FROM reto.agents WHERE username IN ('agente048','agente002'));",
  ]);
});

test("D1 known issue: article, confirmation and no ticket", async ({ browser }) => {
  test.setTimeout(90_000);
  // Cuenta de test activa: agente048 figura cancelada en la réplica y el asistente (que ahora
  // revisa la cuenta) respondería eso en vez del artículo.
  const page = await pageAs(browser, "agente002");
  await page.goto("/soporte");
  await expect(page.getByRole("link", { name: "Mis tickets" })).toBeVisible();
  await ask(page, "No puedo iniciar sesión, me dice usuario o contraseña incorrectos");
  await expect(page.getByRole("link", { name: "Ver artículo" }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Ejemplo", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Sí, se resolvió" }).click();
  await expect(page.getByText(/Me alegra que se haya resuelto/)).toBeVisible();
  await expect(page.getByTestId("ticket-card")).toHaveCount(0);
  await expect(page.getByText("Resuelta").first()).toBeVisible();
});

test("AC-004.11 talk to a person creates the ticket without the model", async ({ browser }) => {
  test.setTimeout(90_000);
  const page = await pageAs(browser, "agente048");
  await page.goto("/soporte");
  await ask(page, "Al generar el certificado de comisiones el PDF sale con los montos en cero");
  await expect(page.getByRole("button", { name: "Hablar con una persona" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 60_000 });
  if ((await page.getByTestId("ticket-card").count()) === 0) await page.getByRole("button", { name: "Hablar con una persona" }).click();
  const card = page.getByTestId("ticket-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/TCK-\d{6}/);
  await expect(card.getByText("Abierto")).toBeVisible();
  await card.getByRole("link", { name: "Abrir ticket" }).click();
  await expect(page.getByText("Reporte original", { exact: true })).toBeVisible();
  await expect(page.getByText("Al generar el certificado de comisiones el PDF sale con los montos en cero").first()).toBeVisible();
});

test("D6 / AC-004.14 the model goes down: draft kept, retry, and ticket form", async ({ browser }) => {
  const page = await pageAs(browser, "agente048");
  await page.goto("/soporte");
  // Simula la caída del proveedor solo para este mensaje.
  await page.route("**/api/support/conversations/*/messages", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "assistant_unavailable", message: "El asistente no está disponible en este momento." }),
    }),
  );
  await ask(page, "La tabla de ventas no carga datos");
  await expect(page.getByText("El asistente no está disponible en este momento").first()).toBeVisible();
  await expect(page.getByLabel("Mensaje para el asistente")).toHaveValue("La tabla de ventas no carga datos");
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await page.getByRole("button", { name: "Crear ticket con el formulario" }).click();
  await expect(page.getByTestId("ticket-card")).toBeVisible();
});

test("AC-006.2/11 chat evidence: consent is off by default and the message shows the file", async ({ browser }) => {
  test.setTimeout(90_000);
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d9a2fc0000000049454e44ae426082",
    "hex",
  );
  const page = await pageAs(browser, "agente048");
  await page.goto("/soporte");
  await page.getByTestId("chat-file-input").setInputFiles({ name: "pantalla.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("list", { name: "Adjuntos para enviar" })).toContainText("pantalla.png");
  const consent = page.getByRole("checkbox", { name: "Permitir que el asistente lea esta imagen" });
  await expect(consent).not.toBeChecked();
  await ask(page, "Me aparece esta pantalla al entrar al tablero");
  const sent = page.getByRole("list", { name: "Adjuntos del mensaje" });
  await expect(sent).toContainText("pantalla.png", { timeout: 60_000 });
  await expect(sent).not.toContainText("Compartida con el asistente");
});
