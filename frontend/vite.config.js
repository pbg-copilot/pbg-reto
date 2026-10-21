import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/auth": "http://localhost:8008",
      "/api": "http://localhost:8008",
      "/health": "http://localhost:8008",
    },
  },
});
