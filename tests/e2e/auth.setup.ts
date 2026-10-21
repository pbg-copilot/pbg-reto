import { expect, test as setup } from "@playwright/test";
import { ACCOUNTS, authFile } from "./helpers";

// Inicia sesión por la UI con cada cuenta de test y guarda la sesión para los casos D1–D6.
for (const username of Object.values(ACCOUNTS)) {
  setup(`login ${username}`, async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Usuario", { exact: true }).fill(username);
    await page.getByLabel("Contraseña", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await expect(page.getByTestId("agent-name")).toBeVisible();
    await page.context().storageState({ path: authFile(username) });
  });
}
