import { randomBytes } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, type App } from "../src/app.js";
import { db } from "../src/db/kysely.js";
import { createS3Client, ensureBucket } from "../src/infra/s3.js";
import { createFakeProvider } from "../src/modules/assistant/fake-provider.js";
import type { AssistantProvider } from "../src/modules/assistant/provider.js";
import { createS3Storage, type AttachmentStorage } from "../src/modules/attachments/storage.js";
import { detectType, sanitizeFilename } from "../src/modules/attachments/validation.js";
import { buildTestApp, closeDb, loginAs, testEnv, TEST_USERS, uniqueKey } from "./helpers.js";

type Actor = { id: string; headers: Record<string, string> };

// 1×1 PNG real y otros archivos de prueba.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d9a2fc0000000049454e44ae426082",
  "hex",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n");
const TEXT = Buffer.from("2026-10-21 10:01 error 500 al exportar\n");
const HTML = Buffer.from("<html><body><script>alert(1)</script></body></html>");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');

// Bucket real de compose, con registro de lo que se sube y se borra.
const env = testEnv();
const s3 = createS3Storage(createS3Client(env), env.S3_BUCKET);
const puts: string[] = [];
const storage: AttachmentStorage = {
  ...s3,
  async put(key, body, type) {
    puts.push(key);
    await s3.put(key, body, type);
  },
};

// Proveedor que registra lo que recibe el modelo (para AC-006.8 y la visión).
const requests: Anthropic.MessageParam[][] = [];
const fake = createFakeProvider(env);
const recording: AssistantProvider = {
  name: "fake",
  complete(request) {
    requests.push(JSON.parse(JSON.stringify(request.messages)));
    return fake.complete(request);
  },
};

let app: App;
let requester: Actor; // agente048
let other: Actor; // agente002
let admin: Actor; // agente015
const tickets: string[] = [];
const conversations: string[] = [];

beforeAll(async () => {
  await ensureBucket(createS3Client(env), env.S3_BUCKET);
  app = await buildTestApp(undefined, { provider: recording, storage });
  requester = await loginAs(TEST_USERS.requester);
  other = await loginAs(TEST_USERS.otherRequester);
  admin = await loginAs(TEST_USERS.admin);
});

afterAll(async () => {
  const keys = await db.selectFrom("helpdesk.attachments").select("storage_key").where("uploader_id", "in", [requester.id, admin.id, other.id]).execute();
  await Promise.allSettled(keys.map((row) => s3.delete(row.storage_key)));
  if (tickets.length) await db.deleteFrom("helpdesk.tickets").where("id", "in", tickets).execute();
  if (conversations.length) await db.deleteFrom("helpdesk.conversations").where("id", "in", conversations).execute();
  await app.close();
  await closeDb();
});

function multipart(files: { name: string; content: Buffer }[], fields: Record<string, string> = {}) {
  const boundary = `----reto${randomBytes(6).toString("hex")}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields))
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (const file of files)
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      file.content,
      Buffer.from("\r\n"),
    );
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

const upload = (actor: Actor, url: string, files: { name: string; content: Buffer }[], fields?: Record<string, string>, key = uniqueKey(), target = app) => {
  const body = multipart(files, fields);
  return target.inject({ method: "POST", url, headers: { ...actor.headers, "idempotency-key": key, "content-type": body.contentType }, payload: body.payload });
};
const get = (actor: Actor, url: string) => app.inject({ method: "GET", url, headers: actor.headers });
const post = (actor: Actor, url: string, payload: unknown, key = uniqueKey()) =>
  app.inject({ method: "POST", url, headers: { ...actor.headers, "idempotency-key": key }, payload: payload as object });

async function newTicket() {
  const res = await post(requester, "/tickets", {
    title: `Adjuntos ${uniqueKey()}`,
    description: "Al exportar aparece un error y adjunto la captura.",
    category: "screens",
    impact: "medium",
  });
  expect(res.statusCode).toBe(201);
  tickets.push(res.json().id);
  return res.json() as { id: string; version: number };
}

describe("T006.2 validation (unit)", () => {
  it("sanitizes names: no paths, no control characters, keeps the extension when cutting", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\ana\\captura.png")).toBe("captura.png");
    expect(sanitizeFilename("re\u0000por\u001fte.pdf")).toBe("reporte.pdf");
    expect(sanitizeFilename(`${"a".repeat(300)}.png`)).toMatch(/^a{196}\.png$/);
    expect(sanitizeFilename("")).toBe("archivo");
  });

  it("detects the real type and requires it to match the extension", async () => {
    expect(await detectType(PNG, "captura.png")).toBe("image/png");
    expect(await detectType(PDF, "reporte.pdf")).toBe("application/pdf");
    expect(await detectType(TEXT, "error.log")).toBe("text/plain");
    await expect(detectType(PNG, "captura.pdf")).rejects.toMatchObject({ statusCode: 415 });
    await expect(detectType(HTML, "captura.png")).rejects.toMatchObject({ statusCode: 415 });
    await expect(detectType(SVG, "logo.svg")).rejects.toMatchObject({ statusCode: 415 });
    await expect(detectType(Buffer.from("hola\u0000mundo"), "nota.txt")).rejects.toMatchObject({ statusCode: 415 });
    await expect(detectType(Buffer.alloc(0), "vacio.txt")).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe("AC-006.1 / AC-006.4 / AC-006.5 upload and authorized download", () => {
  let ticket: { id: string };
  let pngId: string;

  beforeAll(async () => {
    ticket = await newTicket();
  });

  it("the owner uploads public evidence and sees its metadata in the ticket", async () => {
    const res = await upload(requester, `/tickets/${ticket.id}/attachments`, [
      { name: "captura.png", content: PNG },
      { name: "error.log", content: TEXT },
    ]);
    expect(res.statusCode).toBe(201);
    const [png, log] = res.json().attachments;
    expect(png).toMatchObject({ original_name: "captura.png", mime_type: "image/png", size_bytes: PNG.length, visibility: "public", uploader: { id: requester.id }, status: "active" });
    expect(log).toMatchObject({ mime_type: "text/plain" });
    pngId = png.id;
    const detail = (await get(requester, `/tickets/${ticket.id}`)).json();
    expect(detail.attachments.map((a: { id: string }) => a.id)).toEqual([png.id, log.id]);
    expect(detail.events.map((e: { type: string }) => e.type)).toContain("attachment_added");
  });

  it("serves the file by streaming with safe headers; inline only for images", async () => {
    const res = await get(requester, `/attachments/${pngId}/download`);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(PNG)).toBe(true);
    expect(res.headers).toMatchObject({
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    });
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="captura.png"/);
    expect((await get(requester, `/attachments/${pngId}/download?inline=1`)).headers["content-disposition"]).toMatch(/^inline;/);
  });

  it("D5: another requester cannot upload to the ticket or download its files (404)", async () => {
    expect((await upload(other, `/tickets/${ticket.id}/attachments`, [{ name: "x.png", content: PNG }])).statusCode).toBe(404);
    expect((await get(other, `/attachments/${pngId}/download`)).statusCode).toBe(404);
    expect((await get(admin, `/attachments/${pngId}/download`)).statusCode).toBe(200);
  });

  it("does not duplicate on retry with the same Idempotency-Key", async () => {
    const key = uniqueKey();
    const first = await upload(requester, `/tickets/${ticket.id}/attachments`, [{ name: "otra.png", content: PNG }], undefined, key);
    const again = await upload(requester, `/tickets/${ticket.id}/attachments`, [{ name: "otra.png", content: PNG }], undefined, key);
    expect(again.json()).toEqual(first.json());
    const count = await db.selectFrom("helpdesk.attachments").select(db.fn.countAll<string>().as("n")).where("ticket_id", "=", ticket.id).where("original_name", "=", "otra.png").executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
  });
});

describe("AC-006.3 rejected files never reach the bucket", () => {
  it("415 for a disguised or unsupported type, with nothing uploaded", async () => {
    const ticket = await newTicket();
    const before = puts.length;
    for (const file of [
      { name: "captura.png", content: HTML },
      { name: "captura.pdf", content: PNG },
      { name: "logo.svg", content: SVG },
    ]) {
      const res = await upload(requester, `/tickets/${ticket.id}/attachments`, [{ name: "ok.png", content: PNG }, file]);
      expect(res.statusCode).toBe(415);
      expect(res.json().error).toBe("unsupported_file_type");
    }
    expect(puts.length).toBe(before);
  });

  it("413 for a file over the limit, with nothing uploaded", async () => {
    const small = await buildApp({ env: { ...testEnv(), UPLOAD_MAX_BYTES: 64 }, db, provider: recording, storage });
    try {
      const ticket = await newTicket();
      const before = puts.length;
      const res = await upload(requester, `/tickets/${ticket.id}/attachments`, [{ name: "grande.log", content: Buffer.alloc(200, "a") }], undefined, uniqueKey(), small);
      expect(res.statusCode).toBe(413);
      expect(res.json().error).toBe("file_too_large");
      expect(puts.length).toBe(before);
    } finally {
      await small.close();
    }
  });
});

describe("AC-006.4 / AC-006.6 internal evidence stays with the team (D4)", () => {
  it("an attachment on an internal note inherits internal and is invisible to the requester", async () => {
    const ticket = await newTicket();
    const note = await post(admin, `/tickets/${ticket.id}/comments`, { body: "Log del servidor", visibility: "internal" });
    const res = await upload(admin, `/tickets/${ticket.id}/attachments`, [{ name: "servidor.log", content: TEXT }], { comment_id: note.json().id });
    expect(res.statusCode).toBe(201);
    const internal = res.json().attachments[0];
    expect(internal.visibility).toBe("internal");

    const forRequester = (await get(requester, `/tickets/${ticket.id}`)).json();
    expect(forRequester.attachments).toEqual([]);
    expect(JSON.stringify(forRequester)).not.toContain("servidor.log");
    expect((await get(requester, `/attachments/${internal.id}/download`)).statusCode).toBe(404);
    expect((await get(admin, `/tickets/${ticket.id}`)).json().attachments).toHaveLength(1);
  });

  it("a requester cannot upload internal files nor attach to an internal note", async () => {
    const ticket = await newTicket();
    expect((await upload(requester, `/tickets/${ticket.id}/attachments`, [{ name: "a.png", content: PNG }], { visibility: "internal" })).statusCode).toBe(403);
    const note = await post(admin, `/tickets/${ticket.id}/comments`, { body: "Nota", visibility: "internal" });
    expect((await upload(requester, `/tickets/${ticket.id}/attachments`, [{ name: "a.png", content: PNG }], { comment_id: note.json().id })).statusCode).toBe(404);
  });

  it("a closed ticket rejects public evidence (409) but the team can still add internal files", async () => {
    const ticket = await newTicket();
    const closed = await app.inject({
      method: "PATCH",
      url: `/tickets/${ticket.id}/status`,
      headers: admin.headers,
      payload: { status: "closed", version: ticket.version, closure_reason: "invalid", resolution_summary: "Reporte de prueba" },
    });
    expect(closed.statusCode).toBe(200);
    expect((await upload(requester, `/tickets/${ticket.id}/attachments`, [{ name: "a.png", content: PNG }])).statusCode).toBe(409);
    expect((await upload(admin, `/tickets/${ticket.id}/attachments`, [{ name: "a.png", content: PNG }], { visibility: "internal" })).statusCode).toBe(201);
  });
});

describe("AC-006.7 removal is a soft delete with a trace", () => {
  it("only admins remove; the file stops being served and the trace stays", async () => {
    const ticket = await newTicket();
    const file = (await upload(requester, `/tickets/${ticket.id}/attachments`, [{ name: "dato.png", content: PNG }])).json().attachments[0];
    const del = (actor: Actor) =>
      app.inject({ method: "DELETE", url: `/attachments/${file.id}`, headers: actor.headers, payload: { reason: "Contiene datos personales" } });
    expect((await del(requester)).statusCode).toBe(403);
    const removed = await del(admin);
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ status: "removed", download_url: null, removal: { reason: "Contiene datos personales" } });
    expect((await get(requester, `/attachments/${file.id}/download`)).statusCode).toBe(404);
    expect((await get(admin, `/attachments/${file.id}/download`)).statusCode).toBe(404);
    const detail = (await get(requester, `/tickets/${ticket.id}`)).json();
    expect(detail.attachments[0]).toMatchObject({ status: "removed", removal: { reason: "Contiene datos personales" } });
    expect(detail.events.map((e: { type: string }) => e.type)).toContain("attachment_removed");
  });
});

describe("AC-006.2 / AC-006.8 / AC-006.11-13 chat evidence and vision with consent", () => {
  async function newConversation() {
    const res = await post(requester, "/support/conversations", {});
    expect(res.statusCode).toBe(201);
    conversations.push(res.json().id);
    return res.json().id as string;
  }
  const lastUserMessage = () =>
    requests
      .at(-1)!
      .filter((m) => m.role === "user" && Array.isArray(m.content) && !m.content.some((b) => b.type === "tool_result"))
      .at(-1)!;
  const blocksOf = (message: Anthropic.MessageParam) => message.content as Anthropic.ContentBlockParam[];

  it("without consent the model only receives the file metadata, never its content", async () => {
    const id = await newConversation();
    const up = await upload(requester, `/support/conversations/${id}/attachments`, [{ name: "captura.png", content: PNG }]);
    expect(up.statusCode).toBe(201);
    const file = up.json().attachments[0];
    const res = await post(requester, `/support/conversations/${id}/messages`, { text: "No puedo exportar el reporte", attachment_ids: [file.id] });
    expect(res.statusCode).toBe(200);
    expect(res.json().user_message.attachments).toMatchObject([{ id: file.id, shared_with_ai: false }]);
    const message = lastUserMessage();
    expect(blocksOf(message).some((b) => b.type === "image")).toBe(false);
    expect(JSON.stringify(message)).toContain("[Adjuntos de la persona: captura.png (Imagen PNG");
    expect(JSON.stringify(requests.at(-1))).not.toContain(PNG.toString("base64"));
  });

  it("with consent the image goes to the model, stays stable across turns and is not stored as base64", async () => {
    const id = await newConversation();
    const file = (await upload(requester, `/support/conversations/${id}/attachments`, [{ name: "error.png", content: PNG }])).json().attachments[0];
    const res = await post(requester, `/support/conversations/${id}/messages`, {
      text: "Me aparece este error al exportar",
      attachment_ids: [file.id],
      share_images_with_ai: true,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user_message.attachments[0].shared_with_ai).toBe(true);
    const image = blocksOf(lastUserMessage()).find((b): b is Anthropic.ImageBlockParam => b.type === "image");
    expect(image?.source).toMatchObject({ type: "base64", media_type: "image/png", data: PNG.toString("base64") });

    const stored = await db.selectFrom("helpdesk.conversation_messages").select("content").where("conversation_id", "=", id).where("role", "=", "user").execute();
    expect(JSON.stringify(stored)).not.toContain(PNG.toString("base64"));
    expect(JSON.stringify(stored)).toContain("attachment_image");
    const row = await db.selectFrom("helpdesk.attachments").select("shared_with_ai_at").where("id", "=", file.id).executeTakeFirstOrThrow();
    expect(row.shared_with_ai_at).not.toBeNull();

    // Siguiente turno: la misma imagen en el mismo lugar del historial (append-only).
    await post(requester, `/support/conversations/${id}/messages`, { text: "Uso Chrome" });
    const history = requests.at(-1)!;
    const firstUser = history.find((m) => m.role === "user")!;
    expect(blocksOf(firstUser)[0]).toMatchObject({ type: "image", source: { data: PNG.toString("base64") } });
  });

  it("rejects attachments from another conversation or another person", async () => {
    const mine = await newConversation();
    const file = (await upload(requester, `/support/conversations/${mine}/attachments`, [{ name: "a.png", content: PNG }])).json().attachments[0];
    const otherId = await newConversation();
    expect((await post(requester, `/support/conversations/${otherId}/messages`, { text: "hola", attachment_ids: [file.id] })).statusCode).toBe(400);
    expect((await upload(other, `/support/conversations/${mine}/attachments`, [{ name: "a.png", content: PNG }])).statusCode).toBe(404);
    expect((await get(other, `/attachments/${file.id}/download`)).statusCode).toBe(404);
  });

  it("on escalation the chat evidence moves to the ticket", async () => {
    const id = await newConversation();
    const file = (await upload(requester, `/support/conversations/${id}/attachments`, [{ name: "evidencia.png", content: PNG }])).json().attachments[0];
    // "Hablar con una persona" sin pasar por el modelo: el ticket se lleva las evidencias.
    const escalated = await post(requester, `/support/conversations/${id}/escalate`, { note: "Necesito ayuda" });
    expect(escalated.statusCode).toBe(200);
    const ticketId = escalated.json().conversation.ticket.id;
    tickets.push(ticketId);
    const detail = (await get(requester, `/tickets/${ticketId}`)).json();
    expect(detail.attachments).toMatchObject([{ id: file.id, source: "chat", visibility: "public" }]);
    expect(detail.events.map((e: { type: string }) => e.type)).toContain("attachment_added");
    expect((await get(admin, `/attachments/${file.id}/download`)).statusCode).toBe(200);
  });
});
