// pnpm test:e2e y pnpm test:ui (spec 008): cambian el backend al asistente simulado, corren
// Playwright y SIEMPRE restauran el backend y el worker con la configuración del .env, también si
// falla un test o si se interrumpe (Ctrl+C, cerrar la terminal o recargar el editor). Así ningún
// test llama a la API real de Anthropic, aunque el stack tenga Haiku activo.
// Si se cortara de forma abrupta (kill -9), restaurar a mano: `docker compose up -d backend worker`.
// Uso: pnpm test:e2e [argumentos de playwright], por ejemplo `pnpm test:e2e -g D3`.
//      pnpm test:ui [argumentos] usa el mismo flujo con la configuración de tests/ui (--ui).
import { execFileSync, spawn } from "node:child_process";

const SERVICES = ["backend", "worker"];
const ui = process.argv[2] === "--ui";
const config = ui ? "playwright.config.mjs" : "playwright.e2e.config.mjs";
const playwrightArgs = process.argv.slice(ui ? 3 : 2);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const compose = (...args) => execFileSync("docker", ["compose", ...args], { stdio: "inherit" });

async function waitHealthy() {
  for (let attempt = 0; attempt < 90; attempt++) {
    const status = execFileSync("docker", ["compose", "ps", "--format", "{{.Service}} {{.Health}}", ...SERVICES]).toString();
    const rows = status.trim().split("\n").filter(Boolean);
    if (rows.length === SERVICES.length && rows.every((row) => row.endsWith(" healthy"))) return;
    await sleep(2000);
  }
  throw new Error(`Los servicios ${SERVICES.join(", ")} no quedaron healthy a tiempo`);
}

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  console.log("› Restaurando backend y worker con la configuración del .env…");
  compose("up", "-d", ...SERVICES);
}

let child = null;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    child?.kill(signal);
    restore();
    process.exit(130);
  });
}

let status;
try {
  console.log("› Backend y worker con el asistente simulado (AI_PROVIDER=fake)…");
  compose("-f", "compose.yaml", "-f", "compose.e2e.yaml", "up", "-d", ...SERVICES);
  await waitHealthy();
  status = await new Promise((resolve) => {
    child = spawn("pnpm", ["exec", "playwright", "test", "-c", config, ...playwrightArgs], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
} finally {
  restore();
  await waitHealthy();
}
process.exit(status);
