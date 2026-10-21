import { loadEnv } from "./config/env.js";
import { initializeDatabase } from "./db.js";
import { db } from "./db/kysely.js";
import { migrateToLatest } from "./db/migrate.js";
import { runSeeds } from "./db/seed.js";
import { createS3Client, ensureBucket } from "./infra/s3.js";
import { buildApp } from "./app.js";

const env = loadEnv();
const app = await buildApp({
  env,
  db,
  logger: {
    level: env.NODE_ENV === "test" ? "warn" : "info",
    redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
  },
});

await initializeDatabase();
await migrateToLatest(db, {
  info: (msg) => app.log.info(msg),
  error: (obj, msg) => app.log.error(obj, msg),
});
await runSeeds(db, { info: (msg) => app.log.info(msg) });

// S3 puede tardar en arrancar; la API funciona igual y reintenta en segundo plano.
void (async () => {
  const s3 = createS3Client(env);
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const outcome = await ensureBucket(s3, env.S3_BUCKET);
      app.log.info({ bucket: env.S3_BUCKET, outcome }, "s3 bucket ready");
      return;
    } catch (error) {
      app.log.warn({ attempt, err: { type: (error as Error).name } }, "s3 not ready yet");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  app.log.error("s3 bucket unavailable; attachments will fail until it is reachable");
})();

const stop = async () => {
  await app.close();
  await db.destroy();
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());

await app.listen({ port: env.PORT, host: env.HOST });
