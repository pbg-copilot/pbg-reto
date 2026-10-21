import { hostname } from "node:os";
import { loadEnv } from "./config/env.js";
import { db } from "./db/kysely.js";
import { jobHandlers } from "./jobs/handlers.js";
import { createWorker } from "./jobs/runner.js";

const env = loadEnv();

// Logs en JSON de una línea, como los de la API.
const write = (level: string) => (obj: object, msg: string) =>
  console.log(JSON.stringify({ level, time: Date.now(), service: "reto-worker", msg, ...obj }));
const log = { info: write("info"), warn: write("warn"), error: write("error") };

const worker = createWorker({
  db,
  handlers: jobHandlers,
  workerId: `${hostname()}:${process.pid}`,
  concurrency: env.WORKER_CONCURRENCY,
  pollMs: env.WORKER_POLL_MS,
  log,
  heartbeatFile: "/tmp/worker-heartbeat",
});

const stop = async () => {
  log.info({}, "worker stopping");
  await worker.stop();
  await db.destroy();
  process.exit(0);
};
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());

worker.start();
