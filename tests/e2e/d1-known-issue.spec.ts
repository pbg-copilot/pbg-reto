import { expect, test } from "@playwright/test";
import { as, ask, cleanup } from "./helpers";

// D1 (§14): consulta conocida resuelta con un artículo y la confirmación del usuario, sin
// crear un ticket innecesario. AC-004.3, AC-004.5, AC-003.5.
test.afterAll(() => cleanup());

test("D1 · known issue: the assistant answers from the catalog and no ticket is created", async ({ browser }) => {
  const page = await as(browser, "requester");
  const before = (await (await page.request.get("/api/tickets?page_size=1")).json()).total as number;

  await page.goto("/soporte");
  await ask(page, "No puedo iniciar sesión, me dice usuario o contraseña incorrectos");

  // Respuesta basada en un artículo publicado, con su enlace y la marca de ejemplo.
  const article = page.getByRole("link", { name: "Ver artículo" }).first();
  await expect(article).toBeVisible();
  await expect(page.getByText("Ejemplo", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("group", { name: "¿Se resolvió tu problema?" })).toBeVisible();

  await page.getByRole("button", { name: "Sí, se resolvió" }).click();
  await expect(page.getByText(/Me alegra que se haya resuelto/)).toBeVisible();
  await expect(page.getByTestId("ticket-card")).toHaveCount(0);
  await expect(page.getByText("Resuelta").first()).toBeVisible();

  // Mis tickets no cambió: el asistente resolvió sin escalar.
  const after = (await (await page.request.get("/api/tickets?page_size=1")).json()).total as number;
  expect(after).toBe(before);

  // El enlace lleva al artículo publicado.
  await article.click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/sesión|contraseña/i);
});
