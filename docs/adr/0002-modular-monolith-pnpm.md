# ADR 0002 · Monolito modular con pnpm, Fastify y React + Vite

- **Estado:** Aceptada (2026-10-20)
- **Contexto del PDF:** §10, "Extender la base del repositorio: React y TypeScript,
  Fastify y TypeScript, PostgreSQL 16 y Docker Compose. Reutilizar login y sesión."

## Decisión

Un solo repositorio con **pnpm workspaces**:

```text
backend/          API Fastify + worker (mismo código, dos procesos)
frontend/         React + Vite, servido por nginx
packages/shared/  esquemas zod compartidos (contratos de la API)
```

- **Monolito modular.** Hay un solo backend dividido en módulos (`tickets`,
  `assistant`, `articles`, `notifications`…). Cada módulo separa rutas, servicio,
  repositorio y política.
- **Worker.** Es el mismo código con otro punto de entrada (`dist/worker.js`) y corre
  como otro servicio de compose.
- **Escalabilidad.**
  - La API no guarda estado, así que se pueden agregar réplicas.
  - El worker escala en horizontal: reclama jobs con `FOR UPDATE SKIP LOCKED`.
  - PostgreSQL es la única fuente de verdad.

## Por qué pnpm

- `node_modules` estricto: un paquete no puede usar dependencias que no declaró.
- Los scripts de instalación quedan bloqueados salvo los aprobados
  (`allowBuilds: { esbuild: true }`, `strictDepBuilds`).
- `minimumReleaseAge: 1440`: no instala versiones publicadas hace menos de 24 h.
  Mitiga paquetes comprometidos recién publicados. En la primera instalación del
  reto bloqueó dos versiones de ese día.
- Instalaciones más rápidas y un store compartido en disco.

Las vulnerabilidades vienen de los paquetes, no del gestor. pnpm ayuda porque reduce
la superficie de ataque.

## Por qué mantener Fastify (y no Express o Nest)

- **Lo exige el PDF**, y la autenticación existente ya está hecha en Fastify.
- **Validación y serialización por esquema integradas.** Con
  `fastify-type-provider-zod`, el mismo esquema valida, tipa, filtra la respuesta y
  genera el OpenAPI que pide el §12.
- **Plugins encapsulados**, que son la base natural de los módulos.
- **Pruebas con `app.inject()`**, sin levantar puertos.
- **Express** no trae validación, serialización ni OpenAPI integrados.
- **Nest** impone inyección de dependencias y decorators. Es útil en equipos grandes,
  pero en 2 días obliga a reescribir lo existente. La misma disciplina se logra con
  la estructura por módulos.

## Por qué React + Vite (y no Next.js)

- La app es una herramienta interna detrás de un login, sin SEO ni páginas públicas,
  así que el SSR no aporta.
- Next agregaría un segundo servidor que compite con Fastify por la lógica, y
  complicaría la cookie de sesión y la CSP de nginx.
- Vite genera estáticos que nginx sirve con una CSP estricta.

## Consecuencias

- Hay un `pnpm-lock.yaml` único y se eliminaron los tres `package-lock.json`.
- Docker construye con pnpm y la imagen final no lleva dependencias de desarrollo.
- `tests/database.test.mjs` sigue importando `/app/backend/dist/db.js` dentro del
  contenedor.
