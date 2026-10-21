import { expect, test } from "@playwright/test";
import { as, ask, cleanup, compose, createTicket, mailpitCount, RUN, sql } from "./helpers";

// D6 (§14): caída del modelo, fallo de entrega y cambios concurrentes se recuperan; el soporte
// sigue sin IA. AC-004.14, AC-005.8, AC-002.14.
test.afterAll(() => {
  // Mailpit siempre vuelve a quedar arriba, aunque el test falle.
  compose("start", "mailpit");
  cleanup();
});

test("D6a · the model is down: the draft is kept and the ticket form still works", async ({ browser }) => {
  const page = await as(browser, "requester");
  await page.goto("/soporte");
  // [[fail]] simula la caída del proveedor solo para este mensaje.
  const text = "No puedo descargar las facturas del mes [[fail]]";
  await ask(page, text);
  await expect(page.getByRole("alert").filter({ hasText: "El asistente no está disponible en este momento" })).toBeVisible();
  await expect(page.getByLabel("Mensaje para el asistente")).toHaveValue(text);

  await page.getByRole("button", { name: "Crear ticket con el formulario" }).click();
  const card = page.getByTestId("ticket-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(/TCK-\d{6}/);
  await expect(card.getByText("Abierto")).toBeVisible();
});

test("D6b · Mailpit is down: the email stays pending with retries and is delivered once when it comes back", async ({ browser }) => {
  test.setTimeout(180_000);
  const requester = await as(browser, "requester");
  const admin = await as(browser, "admin");
  const ticket = await createTicket(requester, { title: `${RUN} D6 correo con Mailpit caído` });
  const subject = `${ticket.display_number} pasó de Abierto a En revisión`;
  const deliveryOf = () =>
    sql(
      `SELECT d.status || '|' || d.attempts || '|' || coalesce(d.last_error, '') FROM helpdesk.notification_deliveries d JOIN helpdesk.notifications n ON n.id = d.notification_id ` +
        `WHERE n.ticket_id = '${ticket.id}' AND n.type = 'status_changed' AND d.channel = 'email'`,
    );

  compose("stop", "mailpit");
  try {
    const res = await admin.request.patch(`/api/tickets/${ticket.id}/status`, { data: { status: "in_review", version: ticket.version } });
    expect(res.status()).toBe(200);
    // El cambio se guardó; el correo queda pendiente y el worker lo reintenta.
    await expect.poll(deliveryOf, { timeout: 30_000 }).toMatch(/^pending\|[1-9]\d*\|.+/);
    await admin.goto(`/tickets/${ticket.id}`);
    await expect(admin.getByTestId("delivery").filter({ hasText: "Cambio de estado" })).toContainText("Correo · Pendiente");
  } finally {
    compose("start", "mailpit");
  }
  // Al volver Mailpit, el siguiente reintento lo entrega (backoff de 10 s, 20 s, 40 s…).
  await expect.poll(deliveryOf, { timeout: 120_000, intervals: [2_000] }).toMatch(/^delivered\|/);
  await expect.poll(() => mailpitCount(subject), { timeout: 15_000 }).toBe(1);
});

test("D6c · two admins change the same ticket: the stale one sees the conflict and reapplies", async ({ browser }) => {
  const requester = await as(browser, "requester");
  const ticket = await createTicket(requester, { title: `${RUN} D6 conflicto de admins` });
  const adminA = await as(browser, "admin");
  const adminB = await as(browser, "secondAdmin");
  await adminA.goto(`/tickets/${ticket.id}`);
  await adminB.goto(`/tickets/${ticket.id}`);
  await expect(adminB.getByLabel("Prioridad")).toBeVisible();

  await adminA.getByRole("button", { name: "Asignarme" }).click();
  await expect(adminA.getByTestId("toast").filter({ hasText: "Ahora eres responsable" })).toBeVisible();

  // B todavía tiene la versión vieja en pantalla.
  await adminB.getByLabel("Prioridad").click();
  await adminB.getByRole("option", { name: "Urgente" }).click();
  await expect(adminB.getByText("Otro administrador actualizó este ticket")).toBeVisible();
  await adminB.getByRole("button", { name: "Aplicar mi cambio sobre la versión nueva" }).click();
  await expect(adminB.getByText(/cambió la prioridad de .* a Urgente/i)).toBeVisible();

  const final = await (await adminA.request.get(`/api/tickets/${ticket.id}`)).json();
  expect(final.priority).toBe("urgent");
  expect(final.assignee).not.toBeNull();
});
