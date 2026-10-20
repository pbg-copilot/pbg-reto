import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import pg from "pg";
import { hashPassword } from "./passwords.js";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
});
type Seed = {
  metadata: Record<string, unknown>;
  agencies: any[];
  agents: any[];
  clients: any[];
  licenses: any[];
  quotes: any[];
  appointments: any[];
  notes: any[];
  source_records: any[];
};
export async function initializeDatabase() {
  const bytes = await readFile(process.env.SEED_FILE || "../data/seed.json.gz");
  const seed = JSON.parse(gunzipSync(bytes).toString("utf8")) as Seed;
  if (!seed.metadata?.sanitized || seed.agents.length === 0)
    throw new Error("A sanitized dataset with agents is required");
  const importId = createHash("sha256").update(bytes).digest("hex");
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query("SELECT pg_advisory_xact_lock(20261020)");
    await conn.query(
      await readFile(new URL("../schema.sql", import.meta.url), "utf8"),
    );
    const exists = await conn.query("SELECT id FROM reto.imports WHERE id=$1", [
      importId,
    ]);
    if (exists.rowCount === 0) {
      for (const a of seed.agencies)
        await conn.query(
          "INSERT INTO reto.agencies(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
          [a.id, a.name],
        );
      const passwordHash = await hashPassword(
        process.env.DEMO_PASSWORD || "123456",
      );
      for (const a of seed.agents)
        await conn.query(
          "INSERT INTO reto.agents(id,agency_id,username,email,name,phone,role,password_hash,profile) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING",
          [
            a.id,
            a.agency_id,
            a.username,
            a.email,
            a.name,
            a.phone,
            a.role,
            passwordHash,
            a.profile || {},
          ],
        );
      for (const c of seed.clients)
        await conn.query(
          "INSERT INTO reto.clients(id,agent_id,agency_id,name,email,phone,state,stage,profile) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING",
          [
            c.id,
            c.agent_id,
            c.agency_id,
            c.name,
            c.email,
            c.phone,
            c.state,
            c.stage,
            c.profile || {},
          ],
        );
      for (const l of seed.licenses)
        await conn.query(
          "INSERT INTO reto.licenses(id,agent_id,state,license_number,details) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING",
          [l.id, l.agent_id, l.state, l.license_number, l.details || {}],
        );
      for (const q of seed.quotes)
        await conn.query(
          "INSERT INTO reto.quotes(id,agent_id,client_id,carrier,product,details) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING",
          [
            q.id,
            q.agent_id,
            q.client_id,
            q.carrier,
            q.product,
            q.details || {},
          ],
        );
      for (const a of seed.appointments)
        await conn.query(
          "INSERT INTO reto.appointments(id,agent_id,client_id,details) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
          [a.id, a.agent_id, a.client_id, a.details || {}],
        );
      for (const n of seed.notes)
        await conn.query(
          "INSERT INTO reto.notes(id,agent_id,client_id,details) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING",
          [n.id, n.agent_id, n.client_id, n.details || {}],
        );
      for (let i = 0; i < seed.source_records.length; i += 500) {
        await conn.query(
          "INSERT INTO reto.source_records SELECT x.source_table,x.id,x.payload FROM jsonb_to_recordset($1::jsonb) AS x(source_table text,id uuid,payload jsonb) ON CONFLICT DO NOTHING",
          [JSON.stringify(seed.source_records.slice(i, i + 500))],
        );
      }
      await conn.query("INSERT INTO reto.imports(id,metadata) VALUES($1,$2)", [
        importId,
        seed.metadata,
      ]);
    }
    await conn.query("COMMIT");
  } catch (error) {
    await conn.query("ROLLBACK");
    throw error;
  } finally {
    conn.release();
  }
}
