# 001 · Tareas

Antes de empezar, verificar que `docker compose ps` muestre el stack base healthy y
que `pnpm test` pase sobre el repo base. Ese es el punto de referencia.

## Workspace

- [x] **T001.1** Crear `pnpm-workspace.yaml` (con `allowBuilds`, `strictDepBuilds` y
  `minimumReleaseAge`), `packageManager` en la raíz y `pnpm import`. Borrar los tres
  `package-lock.json` y fijar `@vitejs/plugin-react`.
  Test: `pnpm install --frozen-lockfile` sin errores. → AC-001.1
- [x] **T001.2** Crear `packages/shared` (tsconfig, build, `errors.ts` y
  `pagination.ts`) y referenciarlo desde backend y frontend.
  Test: `pnpm -r build`.
- [x] **T001.3** ESLint (flat config) + Prettier, más los scripts `typecheck`, `lint`,
  `test:unit` y `db:migrate`.
  Test: `pnpm typecheck && pnpm lint`. → AC-001.14

## Backend

- [x] **T001.4** Crear `config/env.ts` con zod y fallo claro; `DATA_DIR` y
  `APP_ORIGIN` como lista.
  Test unitario: falta una variable → mensaje sin secretos. → AC-001.8
- [x] **T001.5** Separar `app.ts` (`buildApp`) de `server.ts`; mover auth a
  `modules/auth` sin cambiar el contrato; mantener las exportaciones de `db.ts` y
  `passwords.ts`.
  Test: `tests/api.test.mjs` en verde contra compose. → AC-001.4
- [x] **T001.6** Plugin de errores con el formato común.
  Test con `inject`: 400 con `details.fields` y 404 con `not_found`.
- [x] **T001.7** Plugin de auth (`requireAuth`, `requireAdmin`, `req.actor`) y helper
  de test `loginAs`.
  Test: 401 sin sesión, 403 para un no admin en una ruta admin.
- [x] **T001.8** Kysely sobre el pool, migrador con advisory lock y `0001_foundation`.
  Test: correr la migración dos veces no falla y el esquema `helpdesk` existe. → AC-001.3
- [x] **T001.9** Runner de seeds idempotente (vacío por ahora).
  Test: correrlo dos veces da 0 cambios.
- [x] **T001.10** Plugin de idempotencia.
  Tests: mismo body → mismo resultado con `Idempotent-Replayed`; otro body → 422;
  en curso → 409.
- [x] **T001.11** Swagger y Swagger UI en `/docs`.
  Test: `GET /docs/json` responde 200 e incluye `/auth/get-toke`. → AC-001.7
- [x] **T001.12** Origen permitido por lista.
  Tests: 5173 y 8088 → 200; `https://untrusted.example` → 403. → AC-001.6
- [x] **T001.13** Cola de jobs (`enqueue` dentro de la transacción, `claim` con
  SKIP LOCKED, backoff, recuperación de locks vencidos) y `worker.ts` con latido.
  Tests: `noop` queda en `succeeded`; `fail-once` se reintenta y termina en
  `succeeded`. → AC-001.9
- [x] **T001.14** Scripts `dev` con `tsx watch --env-file=../.env` para API y worker.
  Test manual: `pnpm --filter @reto/backend dev` responde `/health` en 8008, con el
  contenedor `backend` detenido. → AC-001.5

## Infraestructura

- [x] **T001.15** Dockerfiles con pnpm (fetch, deploy y copia explícita de `dist/`).
  Test: `tests/database.test.mjs` en verde. → AC-001.4
- [x] **T001.16** Compose:
  - servicios `worker`, `s3` (verificar que la imagen descargue y fijar el tag),
    `s3-init` (bucket privado) y `mailpit`;
  - `start_period` en postgres;
  - variables nuevas.

  Test: `docker compose up -d --build` → todos healthy y el bucket existe sin acceso
  anónimo. → AC-001.2
- [x] **T001.17** Prefijos nuevos en nginx y en el proxy de Vite, y
  `client_max_body_size`.
  Test: `curl :8088/docs/json` → 200.
- [x] **T001.18** `.env.example` completo con valores falsos y comentarios.
  Test: revisión manual + `git grep -nE 'sk-ant-|AKIA'` vacío. → AC-001.12

## Frontend

- [x] **T001.19** Tailwind 4, shadcn init, tokens claro/oscuro y Poppins con
  `@fontsource`.
  Test: build sin errores y la consola sin violaciones de CSP en :8088. → AC-001.10
- [x] **T001.20** Router, providers (Query y tema), `lib/api.ts` y
  `lib/idempotency.ts`.
- [x] **T001.21** Migrar login e inicio a `features/` con el estilo nuevo y los mismos
  textos y roles accesibles.
  Test: `pnpm test:ui` (`login.spec.js`) en verde, incluido el móvil sin overflow
  horizontal. → AC-001.10
- [x] **T001.22** `AppShell` + `Topbar`: navegación por rol, campana como
  placeholder y menú con solo Logout.
  Test Playwright nuevo: un admin ve "Catálogo" y un agente no. → AC-001.11

## Documentación

- [x] **T001.23** ADR 0001–0004 en `docs/adr/`. → AC-001.13
- [x] **T001.24** README: sección "Desarrollo con pnpm" y servicios nuevos. Marcar la
  spec 001 como Hecha en `specs/README.md`.

## Notas de implementación (2026-10-20)

Diferencias con el plan, todas ya reflejadas en el código y los documentos:

- **T001.1:** no se usó `pnpm import`. La instalación se hizo desde cero con los
  rangos de `package.json`. `minimumReleaseAge` bloqueó dos versiones publicadas ese
  mismo día (`@aws-sdk/client-s3`, `lucide-react`) y se bajó su mínimo.
- **T001.16:** se usa **RustFS** (`rustfs/rustfs:1.0.3`) porque MinIO ya no publica la
  imagen en Docker Hub. No hay servicio `s3-init`: la API crea el bucket privado al
  arrancar, con reintentos (`infra/s3.ts`).
- **T001.17:** la app llama a la API bajo `/api/…` y nginx/Vite quitan el prefijo.
  Evita que `/tickets/:id` (pantalla) choque con `/tickets/:id` (API). `/auth`,
  `/health` y `/docs` siguen sin prefijo.
- **T001.19:**
  - El `--primary` de los botones es `#14768c`: el `#1fa3c4` con texto blanco no
    llega a contraste AA, así que queda como `--brand`.
  - La CSP usa un nonce por respuesta (nginx `$request_id` + `html.cspNonce` de Vite)
    porque Radix inyecta `<style>`.
  - `/docs` permite estilos inline solo para Swagger UI.
- **Extra:** el worker solo reclama tipos de job que sabe procesar.

**Verificación:**
- `pnpm test` (repo base): 6/6.
- `pnpm test:unit`: 24/24.
- `pnpm test:ui`: 5/5.
- `pnpm typecheck` y `pnpm lint`: OK.
- `docker compose up -d --build`: los 6 servicios arriba (5 healthy; `s3` sin
  healthcheck).
