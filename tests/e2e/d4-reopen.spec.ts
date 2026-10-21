import { expect, test } from "@playwright/test";
import { as, cleanup, createTicket, RUN } from "./helpers";

// D4 (§14): el usuario responde y reabre; se conserva el historial; las notas internas y sus
// adjuntos siguen ocultos; el equipo recibe el aviso. AC-002.10, AC-002.12, AC-006.6, AC-005.2.
test.afterAll(() => cleanup());

test("D4 · the requester reopens with a reason; history stays and internal content stays hidden", async ({ browser }) => {
  const requester = await as(browser, "requester");
  const admin = await as(browser, "admin");
  const ticket = await createTicket(requester, { title: `${RUN} D4 la sesión se cierra al exportar` });
  const secret = `Nota interna ${RUN}: el cliente usa una versión vieja`;

  // El equipo trabaja el caso por la API: revisión, nota interna con adjunto, respuesta y cierre.
  const key = () => `${RUN}-${Math.random().toString(36).slice(2)}`;
  await admin.request.patch(`/api/tickets/${ticket.id}/status`, { data: { status: "in_review", version: ticket.version } });
  const note = await (await admin.request.post(`/api/tickets/${ticket.id}/comments`, { headers: { "idempotency-key": key() }, data: { body: secret, visibility: "internal" } })).json();
  const upload = await admin.request.post(`/api/tickets/${ticket.id}/attachments`, {
    headers: { "idempotency-key": key() },
    multipart: { comment_id: note.id, files: { name: "diagnostico-interno.log", mimeType: "text/plain", buffer: Buffer.from("detalle interno\n") } },
  });
  expect(upload.status()).toBe(201);
  const internalFile = (await upload.json()).attachments[0];
  await admin.request.post(`/api/tickets/${ticket.id}/comments`, { headers: { "idempotency-key": key() }, data: { body: "Actualiza la app y vuelve a intentar.", visibility: "public" } });
  const version = (await (await admin.request.get(`/api/tickets/${ticket.id}`)).json()).version;
  const closed = await admin.request.patch(`/api/tickets/${ticket.id}/status`, {
    data: { status: "closed", version, closure_reason: "resolved", resolution_summary: "Se pidió actualizar la app." },
  });
  expect(closed.status()).toBe(200);
  await admin.request.post("/api/notifications/read-all");

  // El solicitante ve la resolución, no lo interno, y reabre con un motivo.
  await requester.goto(`/tickets/${ticket.id}`);
  await expect(requester.getByText("Cerrado · Resuelto", { exact: true })).toBeVisible();
  await expect(requester.getByText("Actualiza la app y vuelve a intentar.")).toBeVisible();
  await expect(requester.getByText(secret)).toHaveCount(0);
  await expect(requester.getByText("diagnostico-interno.log")).toHaveCount(0);
  expect((await requester.request.get(`/api/attachments/${internalFile.id}/download`)).status()).toBe(404);

  await requester.getByRole("button", { name: "Reabrir ticket" }).click();
  await requester.getByLabel("¿Qué pasó?").fill("Volvió a pasar después de actualizar.");
  await requester.getByRole("dialog").getByRole("button", { name: "Reabrir" }).click();
  await expect(requester.getByText("Reabierto 1×")).toBeVisible();

  // Historial completo, sin eventos internos.
  const history = requester.getByRole("region", { name: "Hoy" });
  await expect(history).toContainText("reabrió el ticket: «Volvió a pasar después de actualizar.»");
  await expect(history).toContainText("creó el ticket");
  await expect(requester.getByText("Dejó una nota interna")).toHaveCount(0);

  // Y responde: el comentario queda en el ticket reabierto.
  await requester.getByLabel("Escribe una respuesta").fill("Adjunto más detalles si hace falta.");
  await requester.getByRole("button", { name: "Enviar" }).click();
  // El toast aparece cuando el servidor confirmó (el texto del cuadro no prueba que se envió).
  await expect(requester.getByTestId("toast").filter({ hasText: "Respuesta enviada" })).toBeVisible();
  await expect(requester.getByRole("paragraph").filter({ hasText: "Adjunto más detalles si hace falta." })).toBeVisible();

  // El equipo recibe el aviso de la reapertura y de la respuesta.
  const typesFor = async () => {
    const inbox = await (await admin.request.get("/api/notifications?unread=true&page_size=50")).json();
    return inbox.items.filter((n: { link: string }) => n.link === `/tickets/${ticket.id}`).map((n: { type: string }) => n.type);
  };
  await expect.poll(typesFor).toEqual(expect.arrayContaining(["ticket_reopened", "requester_replied"]));
});
