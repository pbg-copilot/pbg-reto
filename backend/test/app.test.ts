import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { buildTestApp, closeDb, loginAs, TEST_USERS } from "./helpers.js";

let app: App;

beforeAll(async () => {
  app = await buildTestApp((instance) => {
    instance.get("/__test/admin-only", { preHandler: instance.requireAdmin }, async (request) => ({
      role: request.actor?.role,
    }));
    instance.get("/__test/private", { preHandler: instance.requireAuth }, async (request) => ({
      id: request.actor?.id,
    }));
  });
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe("base contract", () => {
  it("health checks PostgreSQL", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "reto-api", database: "ok" });
  });

  it("rejects an empty login body with the common error format", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/get-toke", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request", details: { fields: expect.any(Object) } });
  });

  it("answers unknown routes with not_found", async () => {
    const res = await app.inject({ method: "GET", url: "/no-existe" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });
});

describe("AC-001.6 allowed origins", () => {
  for (const origin of ["http://localhost:8088", "http://localhost:5173"])
    it(`allows login from ${origin}`, async () => {
      const res = await app.inject({
        method: "POST",
        url: "/auth/get-toke",
        headers: { origin },
        payload: { usuario: TEST_USERS.otherRequester, contrasena: "123456" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().agent.username).toBe(TEST_USERS.otherRequester);
    });

  it("rejects an untrusted origin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { origin: "https://untrusted.example" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("origin_not_allowed");
  });
});

describe("auth guards", () => {
  it("returns 401 without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/__test/private" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("unauthorized");
  });

  it("returns 403 for a non-admin on an admin route and 200 for an admin", async () => {
    const requester = await loginAs(TEST_USERS.requester);
    const denied = await app.inject({ method: "GET", url: "/__test/admin-only", headers: requester.headers });
    expect(denied.statusCode).toBe(403);
    const admin = await loginAs(TEST_USERS.admin);
    const allowed = await app.inject({ method: "GET", url: "/__test/admin-only", headers: admin.headers });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().role).toBe("admin");
  });
});

describe("AC-001.7 OpenAPI", () => {
  it("serves the OpenAPI document with the auth endpoints", async () => {
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(["/auth/get-toke", "/auth/me", "/auth/logout", "/health"]));
  });
});
