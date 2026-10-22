import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// The demo writes local application records. Refuse remote API targets.
export const apiUrl = new URL(process.env.API_URL || "http://localhost:8008");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(apiUrl.hostname), "La demo requiere una API local.");

export function inBackend(source) {
  return JSON.parse(execFileSync("docker", ["compose", "exec", "-T", "backend", "node", "--input-type=module"], {
    input: source, encoding: "utf8", timeout: 60_000,
  }));
}

export function query(sql, params = []) {
  return inBackend(`
    import { pool } from './dist/infrastructure/database/db.js';
    try {
      const result = await pool.query(${JSON.stringify(sql)}, ${JSON.stringify(params)});
      console.log(JSON.stringify(result.rows));
    } finally { await pool.end(); }
  `);
}

export async function request(path, { token, method = "GET", body, status = 200 } = {}) {
  const response = await fetch(new URL(path, apiUrl), {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  assert.equal(response.status, status, `${method} ${path}: código HTTP inesperado`);
  return response.status === 204 ? null : response.json();
}

export function login(usuario = "agente099") {
  return request("/auth/get-toke", {
    method: "POST", body: { usuario, contrasena: process.env.DEMO_PASSWORD || "123456" },
  });
}

export function clientFixtures(accountId) {
  return query(`
    SELECT d.path AS document_path, lead->>'id' AS client_record_id,
           EXISTS (SELECT 1 FROM analytics.quotes q
                    WHERE q.lead_id = lead->>'id' AND q.account_id = $1) AS has_quotes
      FROM public.pbg_state_documents d
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(d.document->'leads') = 'array'
             THEN d.document->'leads' ELSE '[]'::jsonb END) lead
     WHERE d.path LIKE 'leads-store/books/%'
       AND d.document->>'ownerKey' = $1 AND lead->>'id' IS NOT NULL
     ORDER BY has_quotes DESC, d.path, lead->>'id' LIMIT 2`, [accountId]);
}

export function futureLocalStart() {
  // Distinct runs choose a different day, then the caller checks the real calendar.
  const date = new Date(Date.now() + (30 + Math.floor(Math.random() * 300)) * 86_400_000);
  return `${date.toISOString().slice(0, 10)}T10:00`;
}
