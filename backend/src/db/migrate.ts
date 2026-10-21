import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Kysely } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";

type Log = { info: (msg: string) => void; error: (obj: unknown, msg: string) => void };

// Kysely toma un advisory lock dentro de la transacción de migración, así que
// la API y un segundo proceso no pueden aplicar la misma migración a la vez.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- patrón oficial de Kysely para migraciones
export async function migrateToLatest(db: Kysely<any>, log: Log) {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: fileURLToPath(new URL("./migrations", import.meta.url)),
    }),
    migrationTableSchema: "helpdesk",
  });
  const { error, results = [] } = await migrator.migrateToLatest();
  for (const result of results)
    if (result.status === "Success") log.info(`migration applied: ${result.migrationName}`);
  if (error) {
    log.error({ err: error }, "migration failed");
    throw error instanceof Error ? error : new Error("Migration failed");
  }
  return results;
}
