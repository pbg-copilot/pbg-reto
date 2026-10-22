import { test, expect } from "@playwright/test";
import { clientFixtures, futureLocalStart, request } from "../demo-helpers.mjs";

test("PBG-14: modal, consultas, ficha y cita por chat con recarga", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByLabel("Usuario", { exact: true }).fill("agente099");
  await page.getByLabel("Contraseña", { exact: true }).fill(process.env.DEMO_PASSWORD || "123456");
  const [authenticated] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/auth/get-toke") && response.request().method() === "POST"),
    page.getByRole("button", { name: "Ingresar", exact: true }).click(),
  ]);
  const { token, agent } = await authenticated.json();
  const client = clientFixtures(agent.id)[0];
  expect(Boolean(client)).toBe(true);
  let conversationId;
  let appointment;
  try {
    await page.getByRole("button", { name: /Abrir Chat PBG/ }).click();
    const dialog = page.getByRole("dialog", { name: "Chat PBG", exact: true });
    const [created] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/conversations") && response.request().method() === "POST"),
      dialog.getByRole("button", { name: "Nueva conversación", exact: true }).click(),
    ]);
    conversationId = (await created.json()).conversation.id;
    const title = `Demo UI PBG-14 ${conversationId.slice(0, 8)}`;
    await dialog.locator(".conversation-entry.selected").getByRole("button", { name: /Cambiar nombre:/ }).click();
    await dialog.getByLabel("Nombre de la conversación", { exact: true }).fill(title);
    await dialog.getByRole("button", { name: "Guardar nombre", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: title, exact: true })).toBeVisible();

    await dialog.getByLabel("Buscar cliente", { exact: true }).fill(client.client_record_id);
    await dialog.getByRole("option").first().click();
    await expect(dialog.getByRole("button", { name: "Su ficha", exact: true })).toBeEnabled();
    const nav = dialog.getByRole("navigation", { name: "Herramientas del espacio" });
    await nav.getByRole("button", { name: "Consultas", exact: true }).click();
    await dialog.getByRole("button", { name: /Expediente.*Perfil, notas/ }).click();
    await expect(dialog.getByRole("heading", { name: "Expediente del cliente", exact: true })).toBeVisible();
    await dialog.getByRole("navigation", { name: "Tipos de consulta" }).getByRole("button", { name: "Cotizaciones", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Cotizaciones disponibles", exact: true })).toBeVisible();
    await expect(dialog.locator(".quote-item").first()).toBeVisible();
    await dialog.getByRole("button", { name: "Su ficha", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Resumen para preparar la conversación", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Volver al chat", exact: true }).click();

    let localStart;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = futureLocalStart();
      const availability = await request(`/api/appointments/availability?${new URLSearchParams({ agentAccountId: agent.id, localStart: candidate, durationMinutes: "30", timeZone: "America/Bogota" })}`, { token });
      if (availability.availability_status === "no_conflict") { localStart = candidate; break; }
    }
    expect(Boolean(localStart)).toBe(true);
    const composer = dialog.getByLabel("Escribe una pregunta o solicitud de cita", { exact: true });
    await composer.fill("Agendar cita");
    await composer.press("Enter");
    await expect(dialog.locator(".assistant-message").last()).toContainText("Indícame la fecha");
    const [date, time] = localStart.split("T");
    await composer.fill(`${date.split("-").reverse().join("/")} ${time}, 30 minutos`);
    await composer.press("Enter");
    await expect(dialog.locator(".assistant-message").last()).toContainText("Confirma la creación de esta cita");

    // Reload restores the confirmation and client when the conversation is opened again.
    await page.reload();
    await page.getByRole("button", { name: /Abrir Chat PBG/ }).click();
    await dialog.locator(".conversation-item").filter({ hasText: title }).click();
    await expect(dialog.locator(".assistant-message").last()).toContainText("Confirma la creación de esta cita");
    await dialog.locator(".conversation-item").filter({ hasText: title }).click();
    await expect(composer).toBeEnabled();
    await expect(dialog.locator(".assistant-message").last()).toContainText("Confirma la creación de esta cita");
    const [executed] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith(`/api/conversations/${conversationId}/appointments`) && response.request().method() === "POST"),
      composer.fill("Confirmar").then(() => composer.press("Enter")),
    ]);
    expect(executed.status()).toBe(201);
    appointment = (await executed.json()).appointment;
    await expect(dialog.locator(".assistant-message").last()).toContainText("La cita quedó guardada");
    await composer.fill("Lista las citas del cliente");
    await composer.press("Enter");
    await expect(dialog.locator(".assistant-message").last()).toContainText("Estas son las citas confirmadas");
    await expect(dialog.locator(".assistant-message").last()).toContainText("30 minutos");
    await expect(dialog.locator(".assistant-message").last()).toContainText("America/Bogota");

    await nav.getByRole("button", { name: "Agenda", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Gestiona tus citas" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cerrar Chat PBG", exact: true }).click();
    await page.getByRole("button", { name: /Abrir Chat PBG/ }).click();
    await expect(dialog.getByRole("heading", { name: "Gestiona tus citas" })).toBeVisible();
    await nav.getByRole("button", { name: "Chat PBG", exact: true }).click();
    await expect.poll(() => dialog.locator(".chat-feed").evaluate((feed) => feed.scrollHeight - feed.clientHeight - feed.scrollTop)).toBeLessThan(5);
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByRole("button", { name: "Restablecer ventana", exact: true }).click();
    const bounds = await dialog.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  } finally {
    if (appointment) {
      const path = `/api/conversations/${conversationId}/appointments`;
      const confirmation = (await request(`${path}/confirm`, { token, method: "POST", body: { action: "cancel", appointmentId: appointment.id }, status: 201 })).confirmation;
      await request(path, { token, method: "POST", body: { confirmationId: confirmation.id, idempotencyKey: confirmation.id }, status: 201 });
    }
    await request("/auth/logout", { token, method: "POST", status: 204 });
  }
});
