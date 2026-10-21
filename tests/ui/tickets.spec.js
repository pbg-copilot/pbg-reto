import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

// Spec 002 en la interfaz. Solo cuentas de test (specs/README.md).
const PREFIX = `E2E ${Date.now().toString(36)}`;

async function login(page, usuario) {
  await page.goto("/");
  await page.getByLabel("Usuario", { exact: true }).fill(usuario);
  await page.getByLabel("Contraseña", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByTestId("agent-name")).toBeVisible();
}

// Un login por cuenta y por archivo: el login del repo base limita a 15 intentos por minuto.
const sessions = new Map();
async function newContextPage(browser, usuario) {
  if (!sessions.has(usuario)) {
    const context = await browser.newContext();
    await login(await context.newPage(), usuario);
    sessions.set(usuario, await context.storageState());
    await context.close();
  }
  const context = await browser.newContext({ storageState: sessions.get(usuario) });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByTestId("agent-name")).toBeVisible();
  return page;
}

async function createTicket(page, title) {
  await page.goto("/tickets/nuevo");
  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Descripción").fill("Al pulsar Exportar aparece un error 500 y no se descarga nada.");
  await page.getByLabel("Categoría").click();
  await page.getByRole("option", { name: "Funcionamiento de pantallas" }).click();
  await page.getByRole("radio", { name: "Alto" }).click();
  await page.getByRole("button", { name: "Crear ticket" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  return page.url().split("/tickets/")[1];
}

test.afterAll(() => {
  // Los tickets de prueba no deben quedar en la bandeja de la demo.
  execFileSync("docker", [
    "compose", "exec", "-T", "postgres", "psql", "-U", "reto", "-d", "reto", "-qc",
    `DELETE FROM helpdesk.tickets WHERE title LIKE '${PREFIX}%'`,
  ]);
});

test("AC-002.20 manual ticket survives a lost response without duplicating", async ({ browser }) => {
  const page = await newContextPage(browser, "agente048");
  const title = `${PREFIX} exportar falla`;
  // La primera respuesta se pierde después de que el servidor ya creó el ticket.
  let dropped = false;
  await page.route("**/api/tickets", async (route) => {
    if (route.request().method() === "POST" && !dropped) {
      dropped = true;
      await route.fetch();
      return route.abort("failed");
    }
    return route.continue();
  });
  await page.goto("/tickets/nuevo");
  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Descripción").fill("Al pulsar Exportar aparece un error 500 y no se descarga nada.");
  await page.getByLabel("Categoría").click();
  await page.getByRole("option", { name: "Funcionamiento de pantallas" }).click();
  await page.getByRole("button", { name: "Crear ticket" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No pudimos conectar" })).toBeVisible();
  // El formulario conserva lo escrito y el reintento reutiliza la misma Idempotency-Key.
  await expect(page.getByLabel("Título")).toHaveValue(title);
  await page.getByRole("button", { name: "Crear ticket" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  await page.goto(`/tickets?q=${encodeURIComponent(title)}`);
  await expect(page.getByRole("link", { name: title })).toHaveCount(1);
});

test("AC-002.8/10/12/13 requester and admin work a ticket; internal notes stay hidden", async ({ browser }) => {
  const requester = await newContextPage(browser, "agente048");
  const title = `${PREFIX} ciclo completo`;
  const id = await createTicket(requester, title);
  await requester.getByLabel("Escribe una respuesta").fill("Uso Chrome en Windows.");
  await requester.getByRole("button", { name: "Enviar" }).click();
  await expect(requester.getByText("Uso Chrome en Windows.")).toBeVisible();

  const admin = await newContextPage(browser, "agente015");
  await admin.goto(`/tickets/${id}`);
  await admin.getByRole("button", { name: "Pasar a En revisión" }).click();
  await expect(admin.getByText("En revisión").first()).toBeVisible();
  await admin.getByRole("radio", { name: "Nota interna" }).click();
  await admin.getByLabel("Nota interna (solo la ve el equipo)").fill("Sospecho del permiso de exportación.");
  await admin.getByRole("button", { name: "Guardar nota" }).click();
  await expect(admin.getByText("Sospecho del permiso de exportación.")).toBeVisible();
  await admin.getByRole("button", { name: "Cerrar ticket" }).click();
  await admin.getByLabel("Resumen de la resolución").fill("Se habilitó el permiso de exportación para tu cuenta.");
  await admin.getByRole("dialog").getByRole("button", { name: "Cerrar ticket" }).click();
  await expect(admin.getByText("Cerrado · Resuelto", { exact: true })).toBeVisible();

  await requester.reload();
  await expect(requester.getByText("Cerrado · Resuelto", { exact: true })).toBeVisible();
  await expect(requester.getByText("Se habilitó el permiso de exportación para tu cuenta.").first()).toBeVisible();
  await expect(requester.getByText("Sospecho del permiso de exportación.")).toHaveCount(0);
  await expect(requester.getByText("Dejó una nota interna")).toHaveCount(0);

  await requester.getByRole("button", { name: "Reabrir ticket" }).click();
  await requester.getByLabel("¿Qué pasó?").fill("Volvió a fallar esta mañana.");
  await requester.getByRole("dialog").getByRole("button", { name: "Reabrir" }).click();
  await expect(requester.getByText("Reabierto 1×")).toBeVisible();
  await expect(requester.getByText("Reabrió el ticket: «Volvió a fallar esta mañana.»")).toBeVisible();
});

test("AC-002.14 two admins: the stale one sees the conflict and can reapply", async ({ browser }) => {
  const requester = await newContextPage(browser, "agente048");
  const id = await createTicket(requester, `${PREFIX} conflicto`);

  const adminA = await newContextPage(browser, "agente015");
  const adminB = await newContextPage(browser, "agente104");
  await adminA.goto(`/tickets/${id}`);
  await adminB.goto(`/tickets/${id}`);
  await expect(adminB.getByLabel("Prioridad")).toBeVisible();

  await adminA.getByRole("button", { name: "Cambiar responsable" }).click();
  await adminA.getByRole("option").nth(1).click();
  await expect(adminA.getByText(/asignó el caso a/i)).toBeVisible();
  await expect(adminA.getByTestId("toast").filter({ hasText: "Asignado a" })).toBeVisible();

  // B todavía tiene la versión vieja en pantalla.
  await adminB.getByLabel("Prioridad").click();
  await adminB.getByRole("option", { name: "Urgente" }).click();
  await expect(adminB.getByText("Otro administrador actualizó este ticket")).toBeVisible();
  await adminB.getByRole("button", { name: "Aplicar mi cambio sobre la versión nueva" }).click();
  await expect(adminB.getByText(/cambió la prioridad de .* a Urgente/i)).toBeVisible();
  await expect(adminB.getByText("Otro administrador actualizó este ticket")).toHaveCount(0);
});

test("AC-002.4 another requester cannot open the ticket by URL", async ({ browser }) => {
  const owner = await newContextPage(browser, "agente048");
  const id = await createTicket(owner, `${PREFIX} privado`);
  const outsider = await newContextPage(browser, "agente049");
  await outsider.goto(`/tickets/${id}`);
  await expect(outsider.getByRole("heading", { name: "Página no disponible" })).toBeVisible();
});

test("AC-005.6/AC-005.10 the bell shows a status change; opening it marks it read; admins see deliveries", async ({ browser }) => {
  const requester = await newContextPage(browser, "agente048");
  const id = await createTicket(requester, `${PREFIX} campana`);
  const { display_number: number } = await (await requester.request.get(`/api/tickets/${id}`)).json();
  // Parte de cero: las notificaciones anteriores de la cuenta de test quedan leídas.
  await requester.request.post("/api/notifications/read-all");

  const admin = await newContextPage(browser, "agente015");
  await admin.goto(`/tickets/${id}`);
  await admin.getByRole("button", { name: "Pasar a En revisión" }).click();
  await expect(admin.getByText("En revisión").first()).toBeVisible();

  // El solicitante no estaba mirando: al volver, la campana tiene el aviso.
  await requester.goto("/");
  await expect(requester.getByTestId("notification-count")).toHaveText("1");
  await requester.getByRole("button", { name: "Notificaciones, 1 sin leer" }).click();
  await requester.getByRole("menuitem", { name: `${number} pasó de Abierto a En revisión` }).click();
  await expect(requester).toHaveURL(new RegExp(`/tickets/${id}$`));
  await expect(requester.getByTestId("notification-count")).toHaveCount(0);

  await requester.goto("/notificaciones");
  await expect(requester.getByRole("heading", { level: 1, name: "Notificaciones" })).toBeVisible();
  await expect(requester.getByRole("link", { name: `${number} pasó de Abierto a En revisión` })).toBeVisible();

  // Panel de entregas: solo admin, con el estado por canal.
  await admin.reload();
  await expect(admin.getByRole("list", { name: "Entregas de notificaciones" })).toBeVisible();
  // Una fila por aviso con el estado de cada canal. En la app queda entregada al
  // confirmarse; el correo puede seguir pendiente un instante.
  const statusDelivery = admin.getByTestId("delivery").filter({ hasText: "Cambio de estado" });
  await expect(statusDelivery).toHaveCount(1);
  await expect(statusDelivery).toContainText("En la app · Entregada");
  await expect(statusDelivery).toContainText(/Correo · (Pendiente|Entregada)/);
  await requester.goto(`/tickets/${id}`);
  await expect(requester.getByRole("list", { name: "Entregas de notificaciones" })).toHaveCount(0);
});

test("assign to me shows a toast with undo; on mobile the actions come before the conversation", async ({ browser }) => {
  const requester = await newContextPage(browser, "agente048");
  const id = await createTicket(requester, `${PREFIX} asignarme`);

  const admin = await newContextPage(browser, "agente015");
  await admin.goto(`/tickets/${id}`);
  await expect(admin.getByTestId("assignee-current")).toContainText("Sin asignar");
  await admin.getByRole("button", { name: "Asignarme" }).click();
  await expect(admin.getByTestId("toast").filter({ hasText: "Ahora eres responsable" })).toBeVisible();
  await expect(admin.getByTestId("assignee-current")).toContainText("Tú");
  await admin.getByTestId("toast").getByRole("button", { name: "Deshacer" }).click();
  await expect(admin.getByTestId("toast").filter({ hasText: "Se quitó el responsable" })).toBeVisible();
  await expect(admin.getByTestId("assignee-current")).toContainText("Sin asignar");

  // Búsqueda dentro del selector.
  await admin.getByRole("button", { name: "Cambiar responsable" }).click();
  await admin.getByLabel("Buscar administrador").fill("zzzz");
  await expect(admin.getByText("Sin resultados")).toBeVisible();
  await admin.keyboard.press("Escape");

  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.reload();
  const actions = await admin.getByRole("button", { name: "Asignarme" }).boundingBox();
  const conversation = await admin.getByText("Conversación con el equipo").boundingBox();
  expect(actions.y).toBeLessThan(conversation.y);
  await admin.getByRole("button", { name: "Cambiar responsable" }).click();
  await expect(admin.getByLabel("Buscar administrador")).toBeVisible();
  expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// 1×1 PNG real para las pruebas de adjuntos.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d9a2fc0000000049454e44ae426082",
  "hex",
);

test("AC-006.1/4/5/7/9 evidence on a reply: preview, authorized download, client validation and removal", async ({ browser }) => {
  const requester = await newContextPage(browser, "agente048");
  const id = await createTicket(requester, `${PREFIX} adjuntos`);

  // Validación en el cliente antes de subir: un SVG no se acepta.
  await requester.getByTestId("file-input").setInputFiles({ name: "logo.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
  await expect(requester.getByRole("alert").filter({ hasText: "no es un tipo admitido" })).toBeVisible();

  await requester.getByTestId("file-input").setInputFiles({ name: "captura.png", mimeType: "image/png", buffer: PNG });
  await expect(requester.getByRole("list", { name: "Archivos para adjuntar" })).toContainText("captura.png");
  await requester.getByLabel("Escribe una respuesta").fill("Adjunto la captura del error.");
  await requester.getByRole("button", { name: "Enviar" }).click();
  await expect(requester.getByTestId("toast").filter({ hasText: "Respuesta enviada con 1 adjunto" })).toBeVisible();
  const item = requester.getByTestId("attachment").filter({ hasText: "captura.png" });
  await expect(item).toContainText("Imagen PNG");
  // La miniatura carga por el endpoint autorizado (mismo origen).
  await expect(item.locator("img")).toHaveJSProperty("complete", true);
  expect(await item.locator("img").evaluate((img) => img.naturalWidth)).toBe(1);
  const href = await item.getByRole("link", { name: "Descargar captura.png" }).first().getAttribute("href");
  const download = await requester.request.get(href);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("image/png");

  // Otro solicitante no puede descargarlo.
  const outsider = await newContextPage(browser, "agente049");
  expect((await outsider.request.get(href)).status()).toBe(404);

  // El admin lo retira con motivo y queda la traza.
  const admin = await newContextPage(browser, "agente015");
  await admin.goto(`/tickets/${id}`);
  await admin.getByRole("button", { name: "Retirar captura.png" }).click();
  await admin.getByLabel("Motivo").fill("Contiene datos personales");
  await admin.getByRole("dialog").getByRole("button", { name: "Retirar" }).click();
  await expect(admin.getByText("Evidencia retirada").first()).toBeVisible();
  await requester.reload();
  await expect(requester.getByText("Motivo: Contiene datos personales")).toBeVisible();
  expect((await requester.request.get(href)).status()).toBe(404);
});

test("AC-007.2 two admins take the same case: the second one is told and nothing is reassigned", async ({ browser }) => {
  const requester = await newContextPage(browser, "agente048");
  const title = `${PREFIX} tomar caso`;
  const id = await createTicket(requester, title);

  const adminA = await newContextPage(browser, "agente015");
  const adminB = await newContextPage(browser, "agente104");
  await adminA.goto(`/tickets?q=${encodeURIComponent(title)}`);
  await adminB.goto(`/tickets?q=${encodeURIComponent(title)}`);
  await adminA.getByRole("button", { name: "Tomar caso" }).first().click();
  await expect(adminA.getByTestId("toast").filter({ hasText: "Tomaste" })).toBeVisible();

  // B todavía ve el botón (bandeja vieja): al pulsarlo se le avisa y no se reasigna.
  await adminB.getByRole("button", { name: "Tomar caso" }).first().click();
  await expect(adminB.getByTestId("toast").filter({ hasText: "No se pudo tomar el caso" })).toContainText("Ya lo tomó");
  const detail = await (await adminA.request.get(`/api/tickets/${id}`)).json();
  expect(detail.status).toBe("in_review");
  const me = await (await adminA.request.get("/auth/me")).json();
  expect(detail.assignee.id).toBe(me.agent.id);
});

test("AC-007.5/7.9 metrics page with formulas; the copilot draft fills the composer and is never sent", async ({ browser }) => {
  test.setTimeout(90_000);
  const admin = await newContextPage(browser, "agente015");
  await admin.goto("/admin/metricas");
  await expect(admin.getByRole("heading", { level: 1, name: "Métricas de atención" })).toBeVisible();
  await expect(admin.getByTestId("kpis")).toContainText("Costo de IA");
  await admin.getByText("¿Cómo se calcula?").click();
  await expect(admin.getByText(/Primer comentario/)).toBeVisible();

  const requester = await newContextPage(browser, "agente048");
  const id = await createTicket(requester, `${PREFIX} copiloto`);
  await admin.goto(`/tickets/${id}`);
  await expect(admin.getByTestId("similar-tickets")).toBeVisible();
  await admin.getByRole("button", { name: "Sugerir respuesta" }).click();
  await expect(admin.getByLabel("Escribe una respuesta")).not.toHaveValue("", { timeout: 60_000 });
  await expect(admin.getByText("Borrador del copiloto (IA): revísalo y edítalo antes de enviar.")).toBeVisible();
  // Nada se envió: el ticket sigue sin comentarios.
  expect((await (await admin.request.get(`/api/tickets/${id}`)).json()).comments).toHaveLength(0);
});
