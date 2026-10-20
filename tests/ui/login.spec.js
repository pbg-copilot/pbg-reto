import { test, expect } from "@playwright/test";
test("login, persisted session, agent name and logout-only account menu", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Inicia sesión" }),
  ).toBeVisible();
  await page.getByLabel("Usuario", { exact: true }).fill("agente001");
  await page.getByLabel("Contraseña", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await expect(page.getByTestId("agent-name")).toBeVisible();
  const name = await page.getByTestId("agent-name").textContent();
  expect(name).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("agent-name")).toHaveText(name);
  await page.getByRole("button", { name: "Menú de cuenta" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(1);
  await expect(page.getByRole("menuitem", { name: "Logout" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Logout" }).click();
  await expect(
    page.getByRole("heading", { name: "Inicia sesión" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Inicia sesión" }),
  ).toBeVisible();
});
test("mobile login has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Ingresar", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
