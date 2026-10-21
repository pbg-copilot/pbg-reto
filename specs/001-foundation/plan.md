# 001 · Plan

## Estructura final

```text
pnpm-workspace.yaml
package.json                 scripts del workspace; "packageManager": "pnpm@11.21.0"
.env.example
compose.yaml
backend/
  Dockerfile
  package.json               @reto/backend
  src/
    app.ts                   buildApp(opts): Fastify + plugins + módulos
    server.ts                initializeDatabase() → migrate() → seed() → listen
    worker.ts                bucle de jobs
    db.ts                    exporta pool, initializeDatabase (contrato del test)
    passwords.ts             sin cambios (contrato del test)
    config/env.ts            esquema zod de variables
    db/kysely.ts             Kysely<DB> sobre el mismo pool
    db/migrate.ts            Migrator + advisory lock
    db/migrations/0001_foundation.ts
    db/seed.ts               runner de seeds idempotente
    db/types.ts              tipos de tablas helpdesk (a mano)
    plugins/auth.ts          decorators requireAuth / requireAdmin, req.actor
    plugins/errors.ts        error handler → formato {error,message,details}
    plugins/idempotency.ts   preHandler + onSend
    plugins/swagger.ts
    jobs/queue.ts            enqueue(tx, type, payload, opts), claim, complete, fail
    jobs/handlers.ts         registro type → handler
    modules/auth/routes.ts   rutas actuales movidas sin cambiar el contrato
  test/                      vitest: helpers (login directo, factories)
frontend/
  Dockerfile  nginx.conf  vite.config.ts  components.json
  src/
    main.tsx
    app/router.tsx  app/providers.tsx  app/layout/AppShell.tsx  app/layout/Topbar.tsx
    features/auth/LoginPage.tsx  features/auth/useSession.ts
    features/home/HomePage.tsx
    components/ui/           shadcn
    lib/api.ts               fetch tipado: credentials same-origin, errores tipados
    lib/idempotency.ts       genera y recuerda claves por intención
    styles/globals.css       Tailwind + tokens + @fontsource/poppins
packages/shared/
  package.json  tsconfig.json
  src/index.ts  src/errors.ts  src/pagination.ts  (cada feature agrega sus esquemas)
docs/adr/0001-helpdesk-schema.md
docs/adr/0002-modular-monolith-pnpm.md
docs/adr/0003-ai-provider-haiku.md
docs/adr/0004-attachments-streaming.md
```

## pnpm

`pnpm-workspace.yaml`:

```yaml
packages:
  - backend
  - frontend
  - packages/*
allowBuilds:
  esbuild: true
strictDepBuilds: true
minimumReleaseAge: 1440
```

- Generar `pnpm-lock.yaml` con `pnpm import`, que lee los `package-lock.json`
  actuales y conserva las versiones. Después borrar los tres `package-lock.json`.
- Fijar `@vitejs/plugin-react` a la versión resuelta del lock en vez de `latest`.

Scripts de la raíz:

| Script | Qué hace |
| --- | --- |
| `dev` | `pnpm -r --parallel --filter ./backend --filter ./frontend dev` (el backend corre API y worker con `concurrently` o dos scripts) |
| `build` | `pnpm -r build` (shared → backend → frontend, en orden topológico) |
| `typecheck` | `pnpm -r typecheck` |
| `lint` | ESLint (flat config) + Prettier |
| `test` | Los tests del repo base sin cambios: `node --test --test-concurrency=1 tests/*.test.mjs` |
| `test:unit` | `pnpm -r test` (vitest) |
| `test:ui` | Playwright (repo base) |
| `test:e2e` | Playwright `tests/e2e` (spec 008) |
| `db:migrate` | `pnpm --filter @reto/backend db:migrate` |

`packages/shared` compila con `tsc` a `dist/` (ESM + `.d.ts`). El frontend lo
consume con Vite y el backend con su build normal.

## Backend

**Refactor sin cambio de comportamiento:**
1. Mover las rutas de auth a `modules/auth/routes.ts` y crear `app.ts` con
   `buildApp()`.
2. `server.ts` queda solo con el arranque: `initializeDatabase`, migraciones, seeds,
   `listen` y cierre ordenado.
3. Reemplazar las rutas absolutas `/app/data/...` por `env.DATA_DIR`, que por
   defecto es `/app/data` y en local `../data`.
4. `APP_ORIGIN` pasa a ser una lista. La validación de `Origin` queda igual y
   compara contra el conjunto.

**`env.ts`** valida estas variables:

| Variable | Ejemplo |
| --- | --- |
| `DATABASE_URL` | `postgres://reto:...@postgres:5432/reto` |
| `APP_ORIGIN` | `http://localhost:8088,http://localhost:5173` |
| `PUBLIC_APP_URL` | `http://localhost:8088` (enlaces en notificaciones) |
| `DATA_DIR` | `/app/data` |
| `SESSION_TTL_HOURS` · `DEMO_PASSWORD` · `PORT` | como hoy |
| `AI_PROVIDER` | `anthropic` \| `fake` (por defecto `fake` si no hay key) |
| `AI_MODEL` | `claude-haiku-5-5` |
| `ANTHROPIC_API_KEY` | vacío en el ejemplo |
| `AI_TIMEOUT_MS` | `20000` |
| `AI_MAX_TOOL_ITERATIONS` | `4` |
| `S3_ENDPOINT` · `S3_REGION` · `S3_BUCKET` · `S3_ACCESS_KEY` · `S3_SECRET_KEY` · `S3_FORCE_PATH_STYLE` | |
| `SMTP_HOST` · `SMTP_PORT` · `MAIL_FROM` · `EMAIL_NOTIFICATIONS` | |
| `UPLOAD_MAX_BYTES` | `10485760` |
| `UPLOAD_MAX_FILES` | `5` |
| `WORKER_POLL_MS` | `1000` |
| `WORKER_CONCURRENCY` | `4` |

**Kysely** se monta sobre el mismo `pool` de `db.ts`, para no tener dos pools en el
mismo proceso.

**Migraciones:** `Migrator` con `FileMigrationProvider` en `dist/db/migrations`. Corren
dentro de `pg_advisory_lock(20261021)` para que API y worker no compitan.

`0001_foundation`:

```sql
CREATE SCHEMA IF NOT EXISTS helpdesk;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- unaccent no es IMMUTABLE; este envoltorio permite usarlo en columnas generadas e índices
CREATE FUNCTION helpdesk.immutable_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE TABLE helpdesk.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 8,
  run_at timestamptz NOT NULL DEFAULT now(),
  locked_by text, locked_until timestamptz,
  last_error text,
  dedupe_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON helpdesk.jobs (run_at) WHERE status = 'queued';

CREATE TABLE helpdesk.idempotency_keys (
  account_id text NOT NULL REFERENCES onboarding.accounts(id),
  key text NOT NULL,
  method text NOT NULL, path text NOT NULL, request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('in_progress','completed')),
  response_status int, response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (account_id, key)
);
```

**Seeds:** `seed.ts` ejecuta los seeders registrados por cada feature. Usan
`INSERT … ON CONFLICT DO NOTHING` sobre claves naturales.

**Worker** (`worker.ts`):
1. Reclama jobs:
   ```sql
   UPDATE jobs SET status='running', locked_by=$w, locked_until=now()+'5 min', attempts=attempts+1
   WHERE id IN (SELECT id FROM jobs WHERE status='queued' AND run_at<=now()
                ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT $n)
   RETURNING *
   ```
2. Si el handler termina bien, el job pasa a `succeeded`.
3. Si falla:
   - vuelve a `queued` con `run_at = now() + min(10 s × 2^attempts, 10 min)`;
   - al llegar a `max_attempts` queda en `failed`.
4. Un barrido periódico re-encola los jobs `running` cuyo `locked_until` ya pasó.
5. Responde a SIGTERM: termina el lote en curso y sale.
6. Tiene `healthcheck` por archivo de latido (`/tmp/worker-heartbeat`, que Docker
   revisa por antigüedad).

`enqueue(tx, …)` recibe la transacción del llamador. Así el job se confirma junto con
el cambio de negocio (outbox).

**Plugins:**
- `auth`: resuelve `req.actor = { id, role, name, email }` con la consulta actual de
  `currentAgent`.
- `errors`: centraliza el formato de error.
- `idempotency`: ver `000-overview/api-conventions.md`.
- `swagger`: `@fastify/swagger` con transform de zod y `@fastify/swagger-ui` en
  `/docs`.

## Docker y compose

**`backend/Dockerfile`** (multi-stage):
1. `node:24-alpine` + `corepack enable`.
2. `pnpm fetch` con el lock y luego `pnpm install --offline --frozen-lockfile`.
3. `pnpm --filter @reto/shared build && pnpm --filter @reto/backend build`.
4. `pnpm deploy --filter @reto/backend --prod /out`.
5. **Copiar `backend/dist` explícitamente** a `/app/dist`, porque `deploy` puede
   omitirlo por `.gitignore`.
6. Imagen final con `WORKDIR /app`, `/app/dist/db.js`, `/app/dist/passwords.js`,
   `/app/data/*.json` y `/app/schema.sql`, igual que hoy.

**`frontend/Dockerfile`**: build con pnpm y el mismo nginx.

Nuevos servicios en `compose.yaml`:

| Servicio | Imagen | Notas |
| --- | --- | --- |
| `worker` | la misma imagen del backend, `command: node dist/worker.js` | `depends_on: backend healthy`, sin puertos |
| `s3` | MinIO (`quay.io/minio/minio:<tag fijo>`) o `rustfs/rustfs:1.0.3` | volumen `s3_data`, puerto 9000 solo en `127.0.0.1` |
| `s3-init` | cliente mc/aws-cli | crea el bucket `reto-attachments` **privado** y termina |
| `mailpit` | `axllent/mailpit:v1.31` | SMTP 1025; UI en `127.0.0.1:8025` |

Además:
- `postgres.healthcheck.start_period: 15m`, para que la primera restauración lenta no
  marque el servicio como unhealthy.
- Variables nuevas pasadas al backend y al worker desde `.env`.

**`nginx.conf`**:
- Agregar `location` para `/support`, `/tickets`, `/attachments`, `/notifications` y
  `/docs`.
- `client_max_body_size 12m` para los adjuntos.
- La CSP no cambia.

**`vite.config.ts`**: proxy de los mismos prefijos a `http://localhost:8008`.

## Frontend

- **Dependencias:** `react-router` 7, `@tanstack/react-query` 5, `tailwindcss` 4
  con `@tailwindcss/vite`, shadcn (`pnpm dlx shadcn@latest init`),
  `@fontsource/poppins` (300–800), `react-hook-form`, `@hookform/resolvers`, `zod`,
  `lucide-react`.
- **Tokens** de `CLAUDE.md` §Diseño como variables CSS en `:root` y `.dark`,
  mapeadas a los nombres de shadcn (`--primary`, `--background`, `--card`,
  `--border`…).
- **Router:**

  | Ruta | Pantalla |
  | --- | --- |
  | `/` | Login si no hay sesión; inicio si la hay |
  | `/soporte` | Placeholder |
  | `/tickets` | Placeholder |
  | `/admin/*` | Placeholder, protegida por rol |

  Se conserva el comportamiento que prueba `login.spec.js`: encabezado
  "Inicia sesión", campos "Usuario" y "Contraseña", botón "Ingresar",
  `data-testid="agent-name"` y un menú con un solo `menuitem` "Logout".
- **`useSession`:** `GET /auth/me` con TanStack Query, revalidado al recuperar el
  foco y cada 60 s, como hoy.
- **`lib/api.ts`:**
  - convierte el error a `ApiError { status, error, message, details }`;
  - si recibe 401, invalida la sesión;
  - no reintenta mutaciones automáticamente: el reintento es explícito y reutiliza la
    misma `Idempotency-Key`.

## Tests

- **Backend:** vitest con `buildApp()` y `app.inject()` contra el Postgres de
  compose.
  - El helper `loginAs(username)` inserta una sesión válida en `reto.sessions` y
    devuelve el header Bearer.
  - Usa solo las cuentas de test definidas en `specs/README.md`.
- **Smoke de la 001:**
  - las migraciones son idempotentes;
  - un job `noop` se procesa y un `fail-once` se reintenta;
  - `/docs/json` es válido;
  - origen permitido y origen rechazado.
- **Repo base:** `pnpm test` y `pnpm test:ui` sin cambios.

## ADRs

| ADR | Decisión |
| --- | --- |
| 0001 | Esquema `helpdesk` nuevo en lugar de reutilizar `support.*` |
| 0002 | Monolito modular sobre pnpm (worker del mismo código); por qué Fastify y no Express/Nest, y React con Vite y no Next.js |
| 0003 | Proveedor de IA: Anthropic `claude-haiku-5-5`, con costos, límites, datos enviados y proveedor `fake` |
| 0004 | Adjuntos servidos por streaming desde la API, con autorización en cada descarga, en vez de URLs firmadas (por CSP y para no exponer el host S3) |
