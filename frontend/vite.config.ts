import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const api = "http://localhost:8008";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // nginx reemplaza este marcador por un nonce aleatorio en cada respuesta (CSP).
  html: { cspNonce: "__CSP_NONCE__" },
  server: {
    // Igual que frontend/nginx.conf: la app llama a /api/… y se quita el prefijo.
    proxy: {
      "/api": { target: api, rewrite: (path) => path.replace(/^\/api/, "") },
      "/docs": api,
    },
  },
});
