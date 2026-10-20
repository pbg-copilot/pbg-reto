import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const bytes = readFileSync(new URL("../data/seed.json.gz", import.meta.url));
const seed = JSON.parse(gunzipSync(bytes));
const manifest = JSON.parse(
  readFileSync(new URL("../data/manifest.json", import.meta.url), "utf8"),
);
test("dataset checksum and record counts match the distributed manifest", () => {
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    manifest.seed_sha256,
  );
  assert.equal(seed.metadata.sanitized, true);
  for (const [table, count] of Object.entries(manifest.counts))
    assert.equal(seed[table].length, count, table);
  assert.ok(seed.clients.length > 0);
  assert.ok(seed.agents.length > 0);
});
test("all identities and references use synthetic identifiers", () => {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const agents = new Set(seed.agents.map((a) => a.id)),
    clients = new Map(seed.clients.map((c) => [c.id, c]));
  const agencies = new Set(seed.agencies.map((a) => a.id));
  for (const a of seed.agents) {
    assert.match(a.id, uuid);
    assert.match(a.email, /@reto\.example$/);
    assert.match(a.phone, /^\+999000\d{9}$/);
    assert.ok(!a.agency_id || agencies.has(a.agency_id));
    assert.equal(a.password_hash, undefined);
  }
  for (const c of seed.clients) {
    assert.match(c.id, uuid);
    assert.ok(agents.has(c.agent_id));
    assert.ok(!c.agency_id || agencies.has(c.agency_id));
    assert.match(c.email, /@reto\.example$/);
    assert.match(c.phone, /^\+999000\d{9}$/);
  }
  for (const table of ["quotes", "appointments", "notes"])
    for (const r of seed[table]) {
      assert.match(r.id, uuid);
      assert.ok(agents.has(r.agent_id));
      if (r.client_id) {
        assert.ok(clients.has(r.client_id));
        assert.equal(clients.get(r.client_id).agent_id, r.agent_id);
      }
    }
  for (const l of seed.licenses) {
    assert.ok(agents.has(l.agent_id));
    assert.match(l.license_number, /^TEST-/);
  }
});
test("the exported payload has no production credentials, links, media or free text", () => {
  const raw = gunzipSync(bytes).toString();
  for (const pattern of [
    /sk-ant-[a-zA-Z0-9_-]{15,}/,
    /AKIA[0-9A-Z]{16}/,
    /postgres(?:ql)?:\/\//,
    /https?:\/\//,
    /acct_[0-9a-f]{8,}/,
    /\bL\d{9,15}\b/,
    /\b\d{3}-\d{2}-\d{4}\b/,
  ])
    assert.equal(pattern.test(raw), false, String(pattern));
  for (const r of seed.source_records) {
    assert.equal(r.payload.password_hash, undefined);
    assert.equal(r.payload.token, undefined);
    assert.equal(r.payload.r2_key, undefined);
  }
  for (const q of seed.quotes) assert.equal(q.details.simulated, true);
});
