import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

// Spec 003 en la interfaz. Solo cuentas de test (specs/README.md).
const PREFIX = `E2E ${Date.now().toString(36)}`;
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

test.afterAll(() => {
  execFileSync("docker", [
    "compose", "exec", "-T", "postgres", "psql", "-U", "reto", "-d", "reto", "-qc",
    `DELETE FROM helpdesk.articles a USING helpdesk.article_versions v WHERE v.article_id = a.id AND v.title LIKE '${PREFIX}%'`,
  ]);
});

test("AC-003.10 / AC-003.11 admin creates and publishes; requester reads only what is published", async ({ browser }) => {
  const admin = await pageAs(browser, "agente015");
  const title = `${PREFIX} Exportar reporte falla`;
  await admin.goto("/admin/catalogo/nuevo");
  await admin.getByLabel("Título").fill(title);
  await admin.getByLabel("Categoría").click();
  await admin.getByRole("option", { name: "Funcionamiento de pantallas" }).click();
  await admin.getByLabel("Síntomas").fill("Al exportar aparece un error.");
  await admin.getByLabel("Pasos de diagnóstico").fill("1. Revisa el rango de fechas.");
  await admin.getByLabel("Solución").fill("1. Reduce el rango a un mes.\n2. Vuelve a exportar.");
  await admin.getByLabel("Condiciones de escalación").fill("Si sigue fallando, crea un ticket.");
  await admin.getByRole("button", { name: "Crear borrador" }).click();
  await expect(admin.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const slugUrl = await admin.evaluate(async (t) => {
    const r = await fetch(`/api/support/articles?status=draft&q=${encodeURIComponent(t)}`);
    return (await r.json()).items[0].slug;
  }, title);

  // Borrador: el solicitante no lo ve.
  const requester = await pageAs(browser, "agente048");
  await requester.goto(`/soporte/articulos/${slugUrl}`);
  await expect(requester.getByRole("heading", { name: "Página no disponible" })).toBeVisible();

  await admin.getByRole("button", { name: "Publicar" }).click();
  await expect(admin.getByText("Publicada", { exact: true })).toBeVisible();

  await requester.goto(`/soporte/articulos/${slugUrl}`);
  await expect(requester.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(requester.getByText("Reduce el rango a un mes.")).toBeVisible();
  await expect(requester.getByRole("link", { name: "Esto no me resolvió: volver al chat" })).toBeVisible();
});

test("AC-003.5 seeded examples are marked as examples for the requester", async ({ browser }) => {
  const requester = await pageAs(browser, "agente048");
  await requester.goto("/soporte/articulos/no-puedo-iniciar-sesion");
  await expect(requester.getByText("Ejemplo — no es un procedimiento oficial de PBG")).toBeVisible();
});

test("catalog is paginated and a never-published draft can be discarded", async ({ browser }) => {
  const admin = await pageAs(browser, "agente015");
  await admin.goto("/admin/catalogo");
  await expect(admin.getByRole("navigation", { name: "Paginación" })).toContainText(/de \d+ artículos/);

  const title = `${PREFIX} Borrador para descartar`;
  await admin.goto("/admin/catalogo/nuevo");
  await admin.getByLabel("Título").fill(title);
  await admin.getByLabel("Categoría").click();
  await admin.getByRole("option", { name: "Otro" }).click();
  await admin.getByLabel("Síntomas").fill("Borrador de prueba.");
  await admin.getByLabel("Pasos de diagnóstico").fill("1. Ninguno.");
  await admin.getByLabel("Solución").fill("1. Ninguna.");
  await admin.getByLabel("Condiciones de escalación").fill("Nunca.");
  await admin.getByRole("button", { name: "Crear borrador" }).click();
  await expect(admin.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await admin.getByRole("button", { name: "Descartar borrador" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Descartar" }).click();
  await expect(admin.getByTestId("toast").filter({ hasText: "Borrador descartado" })).toBeVisible();
  await expect(admin).toHaveURL(/\/admin\/catalogo\?status=draft$/);
  await expect(admin.getByRole("link", { name: title })).toHaveCount(0);
});
