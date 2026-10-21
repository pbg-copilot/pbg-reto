import { test, expect } from "@playwright/test";

// Cuentas de test (specs/README.md): no se usan las de la demo manual.
async function login(page, usuario, { mobile = false } = {}) {
  await page.goto("/");
  await page.getByLabel("Usuario", { exact: true }).fill(usuario);
  await page.getByLabel("Contraseña", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  // En móvil el nombre del agente se oculta y la navegación pasa a una segunda fila.
  if (mobile) await expect(page.getByRole("navigation", { name: "Principal móvil" })).toBeVisible();
  else await expect(page.getByTestId("agent-name")).toBeVisible();
}

function collectCspViolations(page) {
  const violations = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (apply|load|execute)/i.test(message.text()))
      violations.push(message.text());
  });
  return violations;
}

test("AC-001.11 admin sees admin navigation and agent does not", async ({ browser }) => {
  const admin = await browser.newPage();
  await login(admin, "agente015");
  await expect(admin.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Catálogo" })).toBeVisible();

  const agent = await browser.newPage();
  await login(agent, "agente048");
  await expect(agent.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Tickets" })).toBeVisible();
  await expect(agent.getByRole("link", { name: "Catálogo" })).toHaveCount(0);
  await agent.goto("/admin/catalogo");
  await expect(agent.getByRole("heading", { name: "Página no disponible" })).toBeVisible();
});

test("AC-001.10 no CSP violations when opening menus (Radix uses the nonce)", async ({ page }) => {
  const violations = collectCspViolations(page);
  await login(page, "agente048");
  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await expect(page.getByRole("menuitem", { name: "Logout" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Usar tema oscuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(violations).toEqual([]);
});

test("authenticated shell has no horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "agente048", { mobile: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
