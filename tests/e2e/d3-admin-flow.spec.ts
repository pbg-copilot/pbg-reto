import { expect, test } from "@playwright/test";
import { as, cleanup, createTicket, mailpitCount, PNG, RUN } from "./helpers";

// D3 (§14): el admin revisa, comenta, adjunta y cierra; cada transición notifica al
// solicitante aunque no esté conectado. AC-002.8–13, AC-005.1–8, AC-006.1/4.
test.afterAll(() => cleanup());

test("D3 · admin works the case end to end while the requester is offline; notifications persist and emails reach Mailpit", async ({ browser }) => {
  const requester = await as(browser, "requester");
  const ticket = await createTicket(requester, { title: `${RUN} D3 el reporte de ventas no exporta` });
  await requester.request.post("/api/notifications/read-all");
  // El solicitante se desconecta: no tiene ninguna pestaña abierta mientras el admin trabaja.
  await requester.context().close();

  const admin = await as(browser, "admin");
  await admin.goto(`/tickets/${ticket.id}`);
  const toast = (text: string | RegExp) => admin.getByTestId("toast").filter({ hasText: text });

  await admin.getByRole("button", { name: "Pasar a En revisión" }).click();
  await expect(toast("pasó a En revisión")).toBeVisible();

  await admin.getByLabel("Escribe una respuesta").fill("Estamos revisando la exportación del reporte.");
  await admin.getByRole("button", { name: "Enviar" }).click();
  await expect(toast("Respuesta enviada")).toBeVisible();

  // Nota interna con su adjunto: hereda la visibilidad interna.
  await admin.getByRole("radio", { name: "Nota interna" }).click();
  await admin.getByLabel("Nota interna (solo la ve el equipo)").fill(`Revisar el exportador ${RUN}`);
  await admin.getByTestId("file-input").setInputFiles({ name: "servidor.log", mimeType: "text/plain", buffer: Buffer.from("error 500 en el exportador\n") });
  await admin.getByRole("button", { name: "Guardar nota" }).click();
  await expect(toast("Nota interna guardada con 1 adjunto")).toBeVisible();

  // Evidencia pública sin texto.
  await admin.getByRole("radio", { name: "Respuesta al solicitante" }).click();
  await admin.getByTestId("file-input").setInputFiles({ name: "captura.png", mimeType: "image/png", buffer: PNG });
  await admin.getByRole("button", { name: "Adjuntar", exact: true }).click();
  await expect(toast("1 archivo adjuntado")).toBeVisible();

  await admin.getByRole("button", { name: "Cerrar ticket" }).click();
  await admin.getByLabel("Resumen de la resolución").fill("Se corrigió el filtro de fechas del exportador.");
  await admin.getByRole("dialog").getByRole("button", { name: "Cerrar ticket" }).click();
  await expect(admin.getByText("Cerrado · Resuelto", { exact: true })).toBeVisible();

  // El solicitante vuelve: las notificaciones lo estaban esperando.
  const back = await as(browser, "requester");
  await back.goto("/");
  await expect(back.getByTestId("notification-count")).toBeVisible();
  expect(Number(await back.getByTestId("notification-count").textContent())).toBeGreaterThanOrEqual(3);
  await back.goto("/notificaciones?vista=no-leidas");
  await expect(back.getByRole("link", { name: new RegExp(`${ticket.display_number} pasó de Abierto a En revisión`) })).toBeVisible();
  await expect(back.getByRole("link", { name: new RegExp(`${ticket.display_number} pasó de En revisión a Cerrado`) })).toBeVisible();
  await expect(back.getByRole("link", { name: new RegExp(`Nueva respuesta del equipo en ${ticket.display_number}`) })).toBeVisible();
  // La nota interna no generó ningún aviso ni aparece su texto.
  await expect(back.getByText(`Revisar el exportador ${RUN}`)).toHaveCount(0);

  // El worker entregó los correos al buzón local (uno por aviso, sin duplicados).
  await expect.poll(() => mailpitCount(`${ticket.display_number} pasó de En revisión a Cerrado`), { timeout: 30_000 }).toBe(1);
  await expect.poll(() => mailpitCount(`Nueva respuesta del equipo en ${ticket.display_number}`), { timeout: 30_000 }).toBe(1);
});
