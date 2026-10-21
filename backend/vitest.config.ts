import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Comparten la base de compose: se ejecutan en serie.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
