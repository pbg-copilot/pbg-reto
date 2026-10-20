import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  workers: 1,
  use: {
    baseURL: process.env.WEB_URL || "http://localhost:8088",
    trace: "retain-on-failure",
  },
  reporter: "list",
});
