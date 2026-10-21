import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { hashPassword } from "./passwords.js";

// Contrato con tests/database.test.mjs: este módulo exporta `pool` sin otros
// efectos al importarlo, y se ejecuta dentro del contenedor desde /app/backend.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
});

export const dataDir = () => resolve(process.env.DATA_DIR || "/app/data");

export async function initializeDatabase() {
  const bytes = await readFile(resolve(dataDir(), "manifest.json"));
  const manifest = JSON.parse(bytes.toString());
  if (manifest.format_version !== 2)
    throw new Error("Full PostgreSQL replica required");
  const aliases = JSON.parse(
    await readFile(resolve(dataDir(), "test-users.json"), "utf8"),
  ) as { id: string; username: string }[];
  const importId = createHash("sha256").update(bytes).digest("hex");
  const conn = await pool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query("SELECT pg_advisory_xact_lock(20261020)");
    const result = await conn.query(
      "SELECT count(*)::int AS count FROM onboarding.accounts",
    );
    if (result.rows[0].count !== manifest.table_counts["onboarding.accounts"])
      throw new Error("Database initialization is incomplete");
    await conn.query(
      await readFile(new URL("../schema.sql", import.meta.url), "utf8"),
    );
    const exists = await conn.query("SELECT id FROM reto.imports WHERE id=$1", [
      importId,
    ]);
    if (exists.rowCount === 0) {
      for (const a of aliases)
        await conn.query(
          "INSERT INTO reto.account_aliases(account_id,username) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET username=excluded.username",
          [a.id, a.username],
        );
      const hash = await hashPassword(process.env.DEMO_PASSWORD || "123456");
      for (const table of [
        "onboarding.accounts",
        "support.support_operators",
        "teamops.users",
      ])
        await conn.query(`UPDATE ${table} SET password_hash=$1`, [hash]);
      await conn.query("INSERT INTO reto.imports(id,metadata) VALUES($1,$2)", [
        importId,
        manifest,
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
