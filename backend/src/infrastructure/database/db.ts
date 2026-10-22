import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg, { type PoolClient } from "pg";
import { hashPassword } from "../../shared/auth/passwords.js";
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
});

async function applyMigrations(conn: PoolClient) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS reto.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const directory = new URL("../../../", import.meta.url);
  const files = (await readdir(directory))
    .filter((file) => /^migration_\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .sort();

  for (const file of files) {
    const bytes = await readFile(new URL(file, directory));
    const version = file.slice("migration_".length, -".sql".length);
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const applied = await conn.query(
      "SELECT checksum FROM reto.schema_migrations WHERE version=$1",
      [version],
    );

    if (applied.rowCount) {
      if (applied.rows[0].checksum !== checksum)
        throw new Error(`Applied migration ${version} has changed`);
      continue;
    }

    await conn.query(bytes.toString("utf8"));
    await conn.query(
      "INSERT INTO reto.schema_migrations(version,checksum) VALUES($1,$2)",
      [version, checksum],
    );
  }
}

export async function initializeDatabase() {
  const bytes = await readFile("/app/data/manifest.json");
  const manifest = JSON.parse(bytes.toString());
  if (manifest.format_version !== 2)
    throw new Error("Full PostgreSQL replica required");
  const aliases = JSON.parse(
    await readFile("/app/data/test-users.json", "utf8"),
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
      await readFile(new URL("../../../schema.sql", import.meta.url), "utf8"),
    );
    await applyMigrations(conn);
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
