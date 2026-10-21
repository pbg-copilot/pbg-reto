import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { setNonce } from "get-nonce";
import { Providers } from "./app/providers";
import { router } from "./app/router";
import { applyTheme, readTheme } from "./lib/theme";
import "./styles/globals.css";

// nginx entrega un nonce por respuesta (CSP). Los componentes que inyectan <style>
// (por ejemplo, el bloqueo de scroll de Radix) lo usan a través de get-nonce.
const nonce = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.nonce;
if (nonce && nonce !== "__CSP_NONCE__") setNonce(nonce);

applyTheme(readTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
