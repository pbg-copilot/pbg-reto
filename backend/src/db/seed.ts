import type { Database } from "./kysely.js";
import { ticketCatalogsSeeder } from "./seeds/ticket-catalogs.js";
import { articlesSeeder } from "./seeds/articles.js";

export type Seeder = {
  name: string;
  // Debe ser idempotente: INSERT … ON CONFLICT DO NOTHING sobre claves naturales.
  run: (db: Database) => Promise<void>;
};

// Cada spec agrega sus seeders aquí (catálogo demo en 003, categorías en 002…).
export const seeders: Seeder[] = [ticketCatalogsSeeder, articlesSeeder];

export async function runSeeds(db: Database, log: { info: (msg: string) => void }) {
  for (const seeder of seeders) {
    await db.transaction().execute((trx) => seeder.run(trx));
    log.info(`seed applied: ${seeder.name}`);
  }
}
