import test from "node:test";
import assert from "node:assert/strict";
const base = process.env.API_URL || "http://localhost:8008";
const login = (usuario = "agente001", contrasena = "123456") =>
  fetch(base + "/auth/get-toke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usuario, contrasena }),
  });
test("recommended agent, administrator and agency owner keep their original roles", async () => {
  for (const [email, role] of [
    ["agente099@reto.example", "agent"],
    ["agente009@reto.example", "admin"],
    ["agente016@reto.example", "agency_owner"],
  ]) {
    const response = await login(email);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.agent.role, role);
    if (role === "agency_owner") assert.ok(body.agent.agency_id);
    await fetch(base + "/auth/logout", {
      method: "POST",
      headers: { Authorization: "Bearer " + body.token },
    });
  }
});
test("health checks the live PostgreSQL connection", async () => {
  const r = await fetch(base + "/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).database, "ok");
});
test("authentication, revocation and validation against the running API", async () => {
  assert.equal((await fetch(base + "/auth/me")).status, 401);
  assert.equal((await login("agente001", "incorrecta")).status, 401);
  assert.equal((await login("noexiste", "123456")).status, 401);
  const r = await login();
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie"), /HttpOnly/i);
  assert.match(r.headers.get("set-cookie"), /SameSite=Lax/i);
  const body = await r.json();
  assert.equal(body.token_type, "Bearer");
  assert.equal(body.agent.username, "agente001");
  assert.equal(body.agent.password_hash, undefined);
  const headers = { Authorization: "Bearer " + body.token };
  let me = await fetch(base + "/auth/me", { headers });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).agent.id, body.agent.id);
  const next = await (await login()).json();
  assert.equal((await fetch(base + "/auth/me", { headers })).status, 401);
  const h2 = { Authorization: "Bearer " + next.token };
  assert.equal(
    (await fetch(base + "/auth/logout", { method: "POST", headers: h2 }))
      .status,
    204,
  );
  assert.equal((await fetch(base + "/auth/me", { headers: h2 })).status, 401);
  assert.equal(
    (
      await fetch(base + "/auth/get-toke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(base + "/auth/logout", {
        method: "POST",
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
});
