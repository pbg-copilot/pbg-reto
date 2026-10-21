import { defineConfig } from "@playwright/test";

// E2E de los casos mínimos de demostración D1–D6 (spec 008). Se corren con `pnpm test:e2e`,
// que levanta el backend con AI_PROVIDER=fake (respuestas deterministas, sin costo).
export default defineConfig({
  testDir: "./tests/e2e",
  // Comparten la base de compose: en serie.
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.WEB_URL || "http://localhost:8088",
    trace: "retain-on-failure",
  },
  projects: [
    // Un login por cuenta para todo el recorrido (el login limita a 15 intentos por minuto).
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "e2e", testMatch: /d\d-.*\.spec\.ts/, dependencies: ["setup"] },
  ],
  reporter: [["list"]],
});
