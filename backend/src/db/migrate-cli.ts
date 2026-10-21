import { db } from "./kysely.js";
import { migrateToLatest } from "./migrate.js";
import { runSeeds } from "./seed.js";

const log = { info: console.log, error: console.error };

try {
  await migrateToLatest(db, log);
  await runSeeds(db, log);
} finally {
  await db.destroy();
}
