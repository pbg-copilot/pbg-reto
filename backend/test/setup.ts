import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Los tests de integración usan el Postgres de compose (localhost:5439).
const envFile = resolve(import.meta.dirname, "../../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.DATABASE_URL ??= "postgres://reto:reto_local_only@localhost:5439/reto";
process.env.DATA_DIR ??= resolve(import.meta.dirname, "../../data");
// Los tests nunca llaman al modelo real.
process.env.AI_PROVIDER = "fake";
process.env.NODE_ENV = "test";
