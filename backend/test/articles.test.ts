import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { db } from "../src/db/kysely.js";
import { redactPersonalData, slugify } from "../src/modules/articles/text.js";
import { buildTestApp, closeDb, loginAs, TEST_USERS, uniqueKey } from "./helpers.js";

type Actor = { id: string; headers: Record<string, string> };
let app: App;
let requester: Actor;
let admin: Actor;
const articles: string[] = [];
const tickets: string[] = [];

beforeAll(async () => {
  app = await buildTestApp();
  requester = await loginAs(TEST_USERS.requester);
  admin = await loginAs(TEST_USERS.admin);
});

afterAll(async () => {
  if (articles.length) await db.deleteFrom("helpdesk.articles").where("id", "in", articles).execute();
  if (tickets.length) await db.deleteFrom("helpdesk.tickets").where("id", "in", tickets).execute();
  await db.deleteFrom("helpdesk.incidents").where("title", "like", "TEST %").execute();
  await app.close();
  await closeDb();
});

const get = (actor: Actor, url: string) => app.inject({ method: "GET", url, headers: actor.headers });
const send = (actor: Actor, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
  app.inject({ method, url, headers: { ...actor.headers, "idempotency-key": uniqueKey() }, payload: payload as object });
const titles = (body: { items: { title: string }[] }) => body.items.map((item) => item.title);

const draft = (title: string) => ({
  title,
  category: "screens",
  symptoms: "La pantalla de reportes muestra un error al exportar.",
  diagnosis_steps: "1. Revisa el rango de fechas.",
  solution: "1. Recarga la página.",
  escalation_conditions: "Si continúa, crea un ticket.",
  tags: ["Reportes"],
});

async function createArticle(title: string) {
  const res = await send(admin, "POST", "/support/articles", draft(title));
  articles.push(res.json().id);
  return res;
}

describe("text utilities", () => {
  it("builds URL-safe slugs", () => {
    expect(slugify("Sesión cerrada ¡ya!")).toBe("sesion-cerrada-ya");
  });

  it("AC-003.7 redacts personal data", () => {
    const text = "Soy José Núñez (jose.nunez@reto.example, +999 555 123 4567). Ver TCK-000042 y 6c59549a-179f-4454-ac7b-e1f27fd7803b.";
    const clean = redactPersonalData(text, ["José Núñez"]);
    for (const leaked of ["José", "Núñez", "reto.example", "555", "TCK-000042", "6c59549a"]) expect(clean).not.toContain(leaked);
  });
});

describe("AC-003.3 / AC-003.4 / AC-003.5 search and visibility", () => {
  it("finds seeded examples without accents, with typos and by category", async () => {
    const noAccent = (await get(requester, "/support/articles?q=contrasena")).json();
    expect(titles(noAccent).some((t: string) => t.includes("contraseña"))).toBe(true);
    const typo = (await get(requester, "/support/articles?q=inciar%20sesion")).json();
    expect(titles(typo)[0]).toMatch(/iniciar sesión|sesión/i);
    const phrase = (await get(requester, "/support/articles?q=se%20me%20cierra%20la%20sesion")).json();
    expect(titles(phrase)).toContain("La sesión se cierra sola");
    const uploads = (await get(requester, "/support/articles?category=uploads")).json();
    expect(uploads.items.every((a: { category: string }) => a.category === "uploads")).toBe(true);
    const all = (await get(requester, "/support/articles?page_size=50")).json();
    expect(all.items.filter((a: { is_example: boolean }) => a.is_example).length).toBeGreaterThanOrEqual(12);
  });

  it("hides drafts and archived articles from requesters, not from admins", async () => {
    const created = (await createArticle(`TEST borrador ${uniqueKey()}`)).json();
    expect(created).toMatchObject({ status: "draft", latest_version: 1, published_version: null });
    const tag = created.slug;
    expect((await get(requester, `/support/articles/${tag}`)).statusCode).toBe(404);
    expect((await get(admin, `/support/articles?status=draft&page_size=50`)).json().items.map((a: { id: string }) => a.id)).toContain(created.id);
    expect((await get(admin, `/support/articles/${created.id}`)).json().version.version).toBe(1);
    expect((await get(requester, `/support/articles/${created.id}/manage`)).statusCode).toBe(403);
  });
});

describe("AC-003.2 / AC-003.6 versions, publish and archive", () => {
  it("keeps versions immutable and previously published versions readable", async () => {
    const created = (await createArticle(`TEST versiones ${uniqueKey()}`)).json();
    const v1 = created.versions[0];
    expect((await send(requester, "POST", `/support/articles/${created.id}/publish`, { version_id: v1.id })).statusCode).toBe(403);

    const published = (await send(admin, "POST", `/support/articles/${created.id}/publish`, { version_id: v1.id })).json();
    expect(published).toMatchObject({ status: "published", published_version: 1 });

    const v2 = await send(admin, "POST", `/support/articles/${created.id}/versions`, { ...draft(`${created.title} v2`), base_version: 1 });
    expect(v2.statusCode).toBe(201);
    expect(v2.json()).toMatchObject({ latest_version: 2, published_version: 1 });
    // Base desactualizada: otro admin guardó antes.
    const stale = await send(admin, "POST", `/support/articles/${created.id}/versions`, { ...draft("otro"), base_version: 1 });
    expect(stale.statusCode).toBe(409);

    // El solicitante sigue viendo la v1 publicada; la v2 en borrador no es legible.
    expect((await get(requester, `/support/articles/${created.slug}`)).json().version.version).toBe(1);
    expect((await get(requester, `/support/articles/${created.slug}?v=2`)).statusCode).toBe(404);

    const v2id = v2.json().versions[0].id;
    await send(admin, "POST", `/support/articles/${created.id}/publish`, { version_id: v2id });
    const reader = (await get(requester, `/support/articles/${created.slug}`)).json();
    expect(reader).toMatchObject({ is_current: true, version: { version: 2 } });
    // La v1 fue publicada: una conversación vieja puede seguir enlazándola.
    expect((await get(requester, `/support/articles/${created.slug}?v=1`)).json()).toMatchObject({ is_current: false });

    const archived = (await send(admin, "POST", `/support/articles/${created.id}/archive`)).json();
    expect(archived.status).toBe("archived");
    expect((await get(requester, `/support/articles/${created.slug}`)).statusCode).toBe(404);
    expect((await get(requester, `/support/articles/${created.slug}?v=2`)).statusCode).toBe(200);
    expect(titles((await get(requester, `/support/articles?q=${encodeURIComponent(created.title)}`)).json())).not.toContain(created.title);
  });
});

describe("AC-003.7 draft from a resolved ticket", () => {
  it("copies only whitelisted, redacted fields and never internal notes", async () => {
    const ticket = (
      await send(requester, "POST", "/tickets", {
        title: "Exportación falla para Henry",
        description: "Hola, soy Henry David Perez (agente048@reto.example). Al exportar sale error 500.",
        category: "screens",
        impact: "high",
      })
    ).json();
    tickets.push(ticket.id);
    expect((await send(admin, "POST", `/support/articles/from-ticket/${ticket.id}`)).statusCode).toBe(422);

    await send(admin, "POST", `/tickets/${ticket.id}/comments`, { body: "NOTA-INTERNA-SECRETA", visibility: "internal" });
    await send(admin, "PATCH", `/tickets/${ticket.id}/status`, { status: "in_review", version: 1 });
    await send(admin, "PATCH", `/tickets/${ticket.id}/status`, {
      status: "closed",
      version: 2,
      closure_reason: "resolved",
      resolution_summary: "Se habilitó el permiso de exportación (avisado a agente048@reto.example).",
    });
    const res = await send(admin, "POST", `/support/articles/from-ticket/${ticket.id}`);
    expect(res.statusCode).toBe(201);
    const article = res.json();
    articles.push(article.id);
    expect(article).toMatchObject({ status: "draft", is_example: false, source_ticket: { id: ticket.id } });
    const text = JSON.stringify(article.versions[0]);
    // El nombre real se lee de la base: no se copian datos de la réplica al repositorio.
    const owner = await db.selectFrom("reto.agents").select("name").where("username", "=", "agente048").executeTakeFirstOrThrow();
    const nameParts = owner.name.split(/\s+/).filter((part) => part.length > 3);
    for (const leaked of [...nameParts, "agente048", "NOTA-INTERNA-SECRETA", ticket.display_number]) expect(text).not.toContain(leaked);
    expect(article.versions[0].solution).toContain("Se habilitó el permiso de exportación");

    // Idempotente: otro clic vuelve al mismo borrador en vez de crear uno nuevo.
    const again = await send(admin, "POST", `/support/articles/from-ticket/${ticket.id}`);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ id: article.id, reused: true });
    const count = await db.selectFrom("helpdesk.articles").select(db.fn.countAll<string>().as("n")).where("source_ticket_id", "=", ticket.id).executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);

    // Descartar: solo admin y solo un borrador nunca publicado.
    expect((await send(requester, "DELETE", `/support/articles/${article.id}`)).statusCode).toBe(403);
    expect((await send(admin, "DELETE", `/support/articles/${article.id}`)).statusCode).toBe(204);
    expect((await send(admin, "DELETE", `/support/articles/${article.id}`)).statusCode).toBe(404);
    // Después de descartarlo, se puede volver a crear desde el ticket.
    const fresh = await send(admin, "POST", `/support/articles/from-ticket/${ticket.id}`);
    expect(fresh.statusCode).toBe(201);
    articles.push(fresh.json().id);
  });

  it("never discards an article that was published (409): it is archived instead", async () => {
    const published = (await send(admin, "GET", "/support/articles?status=published&page_size=1")).json().items[0];
    expect((await send(admin, "DELETE", `/support/articles/${published.id}`)).statusCode).toBe(409);
  });
});

describe("AC-003.8 / AC-003.9 incidents", () => {
  it("exposes only public fields and links tickets with a public event", async () => {
    const created = await send(admin, "POST", "/support/incidents", {
      title: "TEST Lentitud general",
      public_summary: "Estamos investigando lentitud.",
      status: "investigating",
      category: "screens",
    });
    expect(created.statusCode).toBe(201);
    const incident = created.json();
    expect((await send(requester, "POST", "/support/incidents", { title: "x", public_summary: "y" })).statusCode).toBe(403);

    const ticket = (await send(requester, "POST", "/tickets", { title: "Todo va lento", description: "Las pantallas tardan mucho en cargar.", category: "screens" })).json();
    tickets.push(ticket.id);
    const linked = await send(admin, "PATCH", `/tickets/${ticket.id}`, { version: 1, incident_id: incident.id });
    expect(linked.json().incident).toMatchObject({ id: incident.id, status: "investigating" });

    const mine = (await get(requester, `/tickets/${ticket.id}`)).json();
    expect(mine.incident.title).toBe("TEST Lentitud general");
    expect(mine.events.map((e: { type: string }) => e.type)).toContain("incident_linked");

    const publicList = (await get(requester, "/support/incidents?active=true&page_size=50")).json().items;
    const fromRequester = publicList.find((i: { id: string }) => i.id === incident.id);
    expect(fromRequester).not.toHaveProperty("linked_tickets");
    const adminList = (await get(admin, "/support/incidents?active=true&page_size=50")).json().items;
    expect(adminList.find((i: { id: string }) => i.id === incident.id).linked_tickets).toBe(1);

    const resolved = (await send(admin, "PATCH", `/support/incidents/${incident.id}`, { status: "resolved" })).json();
    expect(resolved.resolved_at).not.toBeNull();
    const active = (await get(requester, "/support/incidents?active=true&page_size=50")).json().items;
    expect(active.map((i: { id: string }) => i.id)).not.toContain(incident.id);
  });

  it("paginates incidents and conversations with totals", async () => {
    const page = (await get(admin, "/support/incidents?page=1&page_size=1")).json();
    expect(page).toMatchObject({ page: 1, page_size: 1 });
    expect(page.items.length).toBeLessThanOrEqual(1);
    expect(page.total).toBeGreaterThanOrEqual(page.items.length);
    const conversations = await get(requester, "/support/conversations?page=1&page_size=5");
    expect(conversations.statusCode).toBe(200);
    expect(conversations.json()).toMatchObject({ page: 1, page_size: 5, items: expect.any(Array), total: expect.any(Number) });
  });
});
