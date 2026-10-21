import { randomBytes } from "node:crypto";
import { loadEnv } from "../src/config/env.js";
import { pool } from "../src/db.js";
import { db } from "../src/db/kysely.js";
import { migrateToLatest } from "../src/db/migrate.js";
import { digest } from "../src/modules/auth/session.js";
import { buildApp, type App, type BuildAppOptions } from "../src/app.js";

// Cuentas reservadas para tests (specs/README.md). Nunca las de la demo manual.
export const TEST_USERS = {
  requester: "agente048",
  agencyOwner: "agente049",
  otherRequester: "agente002",
  admin: "agente015",
  secondAdmin: "agente104",
} as const;

export const testEnv = () =>
  loadEnv({
    ...process.env,
    APP_ORIGIN: "http://localhost:8088,http://localhost:5173",
  });

const silentLog = { info: () => {}, error: () => {} };
let migrated = false;

export async function buildTestApp(
  configure?: (app: App) => void | Promise<void>,
  options: Pick<BuildAppOptions, "provider"> = {},
) {
  if (!migrated) {
    await migrateToLatest(db, silentLog);
    migrated = true;
  }
  const app = await buildApp({ env: testEnv(), db, ...options });
  await configure?.(app);
  await app.ready();
  return app;
}

// Crea una sesión directamente en la base (equivale a un login) y devuelve el header.
export async function loginAs(username: string) {
  const token = randomBytes(32).toString("base64url");
  const { rows } = await pool.query<{ id: string }>(
    "SELECT id FROM reto.agents WHERE username=$1",
    [username],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`Unknown test user ${username}`);
  await pool.query(
    `INSERT INTO reto.sessions(token_hash, agent_id, expires_at) VALUES ($1, $2, now() + interval '1 hour')
     ON CONFLICT (agent_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at`,
    [digest(token), id],
  );
  return { id, headers: { authorization: `Bearer ${token}` } };
}

export const uniqueKey = (prefix = "test") => `${prefix}-${randomBytes(8).toString("hex")}`;

export async function closeDb() {
  await db.destroy();
}
