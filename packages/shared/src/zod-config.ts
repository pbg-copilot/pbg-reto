import { z } from "zod";

// zod 4 decide al construir cada z.object si compila sus validadores con `new Function` (JIT).
// En el navegador la CSP no permite eval y esa prueba deja una violación en la consola, así
// que ahí se usa el modo jitless. Tiene que correr antes de construir cualquier esquema:
// index.ts lo importa primero. En el backend (Node) se mantiene el JIT.
if (typeof window !== "undefined") z.config({ jitless: true });
