# CLAUDE.md · RETO · Soporte y tickets con IA

Reglas para trabajar en este repositorio. El enunciado completo está en
`docs/Reto_Soporte_Tickets_IA_PBG.pdf` (secciones 01–15). Si algo de este archivo
contradice el PDF, manda el PDF.

## Contexto

- Repo base de PBG: `github.com/pbg-copilot/pbg-reto`. Rama de trabajo:
  `tickets-ia-alex-castro`. Se entrega por pull request a `main`; nunca hacer merge
  ni desplegar.
- Plazo: 2 días (cierre 2026-10-22). Los 6 casos mínimos de demostración (PDF §14)
  van antes que cualquier extra.
- La base ya trae login y sesión (`POST /auth/get-toke`, `GET /auth/me`,
  `POST /auth/logout`) y una réplica de PostgreSQL de 182 tablas con **datos
  personales reales**.
- Usuarios de prueba (contraseña `123456`): solicitante `agente099@reto.example`,
  admin `agente009@reto.example`, dueño de agencia `agente016@reto.example`.

## Reglas que no se rompen

1. No modificar `data/postgres/`, `database/init/` ni los esquemas originales
   (`onboarding`, `support`, `teamops`, `public`, etc.). Todo lo nuevo vive en el
   esquema `helpdesk` y se crea con migraciones. El esquema `support.*` heredado no
   se reutiliza; la decisión está en `docs/adr/`.
2. Mantener el contrato de `/auth/get-toke` (`usuario`, `contrasena`). La identidad
   sale de `reto.sessions` + `reto.agents`; no crear otro sistema de login.
3. Artículos, tickets y conversaciones de demo son siempre ficticios y van marcados
   como ejemplo. Nunca copiar datos de las tablas originales a seeds, fixtures, logs
   o prompts del modelo.
4. No commitear secretos (`.env`, API keys). Solo `.env.example` con valores falsos.
5. No agregar binarios pesados al repo: dumps, uploads, volúmenes de MinIO, videos.
6. No ejecutar `docker compose down -v` sin confirmarlo con el usuario: borra la base
   restaurada y la restauración tarda varios minutos.

## Stack

Confirmado el 2026-10-20: monolito modular en un workspace de pnpm. El resto de la
tabla es la propuesta vigente; si cambia, actualizarla.

| Capa | Tecnología |
| --- | --- |
| Paquetes | pnpm workspaces (`packageManager` fijado en la raíz) |
| API | Node 24, Fastify 5, TypeScript estricto, ESM |
| Contratos | Zod + `fastify-type-provider-zod`; esquemas compartidos en `packages/shared` |
| OpenAPI | `@fastify/swagger` + `@fastify/swagger-ui` en `/docs` |
| Datos | PostgreSQL 16, `pg` + Kysely (consultas tipadas y migraciones) |
| Búsqueda | Full-text search de Postgres (`spanish` + `unaccent`) y `pg_trgm` |
| Jobs | Tabla `helpdesk.jobs` + worker propio con `FOR UPDATE SKIP LOCKED` |
| Adjuntos | S3 compatible (MinIO o RustFS) con `@aws-sdk/client-s3`; la API los sirve por streaming |
| Correo (opcional) | Mailpit + nodemailer; nunca enviar correos reales |
| IA | `@anthropic-ai/sdk`, modelo en `AI_MODEL` (por defecto `claude-haiku-5-5`) |
| Web | React 19, Vite 8, React Router 7, TanStack Query, Tailwind CSS 4 + shadcn/ui, react-hook-form |
| Tests | Vitest (unidad + integración con `app.inject`), Playwright (E2E), los `node:test` existentes |

## Estructura

Se conservan las carpetas `backend/` y `frontend/` del repo base.

```text
backend/src/
  app.ts               buildApp(): plugins + módulos (lo usan los tests)
  server.ts            arranque HTTP
  worker.ts            procesa helpdesk.jobs (mismo código, otro proceso)
  config/env.ts        variables de entorno validadas con zod
  plugins/             auth, db, errores, idempotencia, swagger, rate limit
  modules/<módulo>/    routes.ts · service.ts · repository.ts · policy.ts · schemas.ts
  db/migrations/       solo el esquema helpdesk
  db/seeds/            catálogo demo ficticio
frontend/src/
  app/                 router y providers
  features/<feature>/  support-chat, tickets, admin, catalog, notifications
  components/ui/       componentes shadcn
  lib/api.ts           cliente HTTP tipado con los esquemas de packages/shared
packages/shared/       esquemas zod y tipos de la API
specs/                 SDD: NNN-feature/{spec,plan,tasks}.md
docs/adr/              decisiones técnicas
```

Módulos: `auth`, `conversations`, `assistant`, `articles`, `tickets`, `comments`,
`attachments`, `notifications`, `metrics`.

Capas:
- `routes`: solo HTTP (esquema, códigos de estado, serialización).
- `service`: reglas de negocio y autorización.
- `repository`: solo SQL parametrizado, siempre filtrado por el actor.
- Ni lógica de negocio en las rutas ni SQL en los servicios.

## Reglas de dominio

- Estados `open | in_review | closed`; en la UI se muestran como Abierto,
  En revisión y Cerrado.
- Transiciones permitidas:
  - `open → in_review`
  - `in_review → closed`, con resumen de resolución obligatorio
  - `open → closed`, con motivo explícito (duplicado, reporte inválido)
  - `closed → open`, reapertura que conserva el historial
- Pedir el mismo estado que ya tiene responde 200 sin crear evento.
- Concurrencia optimista: cada cambio de ticket envía su `version`. Si no coincide,
  la API responde 409 con el estado actual para que la UI lo resuelva.
- El cambio de estado, el `ticket_event`, la notificación y el job de entrega se
  guardan en la **misma transacción** (outbox). El worker reintenta con backoff y
  registra `pending | delivered | failed` por canal.
- Los POST de creación y de acciones con efectos aceptan `Idempotency-Key`. Un
  reintento devuelve la respuesta guardada, no un duplicado.
- Número visible `TCK-000123` (secuencia) e ID interno uuid.
- El reporte original del usuario se guarda separado del resumen generado por IA.

## Seguridad y permisos

- El solicitante solo ve sus tickets. Compartir agencia no da acceso. Solo
  `role = 'admin'` gestiona tickets. Un ticket o adjunto ajeno responde 404, no 403.
- Las notas internas y sus adjuntos se filtran en el repositorio según el rol.
  Nunca aparecen en notificaciones, en respuestas al solicitante ni en lo que se
  envía al modelo.
- Adjuntos privados: la API autoriza cada descarga y la sirve por streaming desde un
  bucket privado (ADR 0004). No se usan URLs firmadas: la CSP y el host S3 interno lo
  impiden. Usar lista blanca de tipos, límite de tamaño y verificar magic bytes en el
  servidor.
- Rate limit en login, chat y subida de archivos. Los logs no llevan tokens,
  cookies ni datos personales.
- Cada endpoint nuevo tiene un test con tres actores: dueño, otro usuario y admin.

## Reglas del asistente de IA

- El modelo nunca decide identidad, permisos, IDs ni enlaces.
- Herramientas permitidas: `search_articles`, `get_article`, `update_case_details`,
  `create_ticket` y `get_my_tickets` (detalle en `specs/004-assistant/plan.md`).
  - En `create_ticket`, el backend pone el solicitante desde la sesión y devuelve el
    número real.
  - Ninguna herramienta cambia estados ni cierra tickets.
  - La 009 suma `get_my_account_status` (solo lectura, sin historial de accesos) y las
    herramientas `propose_*`. Estas **solo proponen**: la persona confirma con un
    clic y el backend ejecuta con su sesión. Toda herramienta futura que escriba
    datos sigue ese patrón.
  - La visión (006) solo procesa imágenes del chat propio, con consentimiento y en
    ese turno.
  - El borrador del copiloto (007) se arma sin notas internas y nunca se envía solo.
  - MCP, Agent Skills y embeddings: ver `docs/adr/0005-ai-capabilities-roadmap.md`.
- Validar en el servidor cada input de herramienta con zod.
- Los mensajes, artículos y adjuntos son datos, no instrucciones (prompt injection).
- El número y el enlace del ticket que ve el usuario salen de la respuesta del
  backend, no del texto del modelo.
- Mandar el mínimo de contexto al modelo: nada de notas internas, secretos ni casos
  ajenos.
- Guardar `article_id` + versión usados en cada respuesta y el `usage` de tokens para
  calcular costos.
- Si el proveedor falla o se agota el tiempo de espera, el chat ofrece un formulario
  manual de ticket y conserva la conversación. El soporte no depende de la IA.
- Notas de la API con `claude-haiku-5-5` ($0.10 / $0.50 por millón de tokens con
  prompts de hasta 100K; cache hit $0.01):
  - El thinking adaptativo viene activo por defecto. Se controla con
    `output_config.effort`; usar `low` para el chat. Nunca `budget_tokens`.
  - No enviar `temperature`, `top_p` ni `top_k` (dan 400). No usar prefill: el
    último mensaje siempre es del usuario.
  - Leer los content blocks por `type`, nunca por posición. El thinking cuenta
    dentro de `max_tokens`, así que no hay que usar límites muy bajos.
  - `tool_choice: auto` y explicar en el prompt cuándo usar cada herramienta. Las
    herramientas llevan `strict: true`.
  - Historial append-only: guardar los content blocks completos del asistente y
    reenviarlos sin modificar, incluidos los `thinking`.
  - Haiku no tiene fallback del servidor ante `refusal`. Revisar `stop_reason`
    (`refusal`, `max_tokens`) y, si falla, ofrecer el formulario de ticket.
  - Área, intención, resultado esperado, error e impacto se registran con la
    herramienta `update_case_details`.
  - El prefijo estable (system + tools) va primero, para aprovechar el prompt
    caching.
- Los tests usan un proveedor simulado (`AI_PROVIDER=fake`). La API real solo se
  usa en demo y en pruebas manuales.

## Comandos

Docker:

```sh
cp .env.example .env                 # opcional, valores por defecto
docker compose up -d --build         # postgres, backend, worker, frontend, s3, mailpit
docker compose logs -f postgres      # seguir la restauración (solo la primera vez)
docker compose ps                    # estado y healthchecks
docker compose exec postgres psql -U reto -d reto
docker compose down                  # detiene y conserva los datos
```

pnpm:

```sh
pnpm install
pnpm dev                             # shared + API :8008 + worker + web :5173 (detener antes los contenedores backend/worker/frontend)
pnpm db:migrate
pnpm typecheck && pnpm lint
pnpm test                            # tests del repo base (no modificarlos)
pnpm test:unit                       # vitest del backend (app.inject + Postgres de compose)
pnpm test:ui                         # Playwright contra :8088
```

URLs:
- app: `:8088`
- API: `:8008`
- docs: `:8088/docs`
- Mailpit: `:8025`
- consola S3: `:9001`

## Gotchas

- La app llama a la API bajo `/api/…` (nginx y Vite quitan el prefijo). El backend
  expone las rutas del PDF sin prefijo. Nunca hacer `fetch` sin pasar por
  `lib/api.ts`.
- `APP_ORIGIN` es una lista. Un `Origin` fuera de la lista recibe 403
  (`tests/api.test.mjs` lo exige).
- Hay una sola sesión activa por cuenta y una sola cookie por navegador. En los tests,
  solo cuentas reservadas (`specs/README.md`). `pnpm test` (repo base) cierra la
  sesión de las cuentas de demo.
- **CSP con nonce:** nginx reemplaza `__CSP_NONCE__` y `main.tsx` lo pasa a
  `get-nonce`.
  - No agregar `<script>` ni `<style>` inline.
  - No usar librerías que inyecten estilos sin soporte de nonce.
- `tests/database.test.mjs` importa `/app/backend/dist/db.js` (exporta `pool`) y
  `dist/passwords.js` dentro del contenedor. No mover esos módulos ni darles efectos
  secundarios al importarlos.
- Las extensiones van con `SCHEMA public`: el `search_path` empieza por `"$user"` y
  existe un esquema `reto`.
- Componentes de shadcn: `pnpm dlx shadcn@latest add -c frontend <componente>`. Los
  archivos de `components/ui/` no se editan a mano.
  - El paquete `shadcn` (el CLI) **no** se instala como dependencia: arrastra
    `braces` vulnerable (GHSA-vfj7-8cjw-p6xm).
  - Su CSS está copiado en `frontend/src/styles/shadcn.css`. Si `add` vuelve a
    escribir `@import "shadcn/tailwind.css"` o agrega la dependencia, se revierte.
- La key de Anthropic debe estar asociada a un workspace. Una `sk-ant-usr-…` pide el
  header `anthropic-workspace-id`.

## Flujo SDD (Spec-Driven Development)

1. `spec.md`: problema, historias de usuario y criterios de aceptación en
   Given/When/Then, cada uno con referencia a la sección del PDF. Incluye lo que
   queda fuera de alcance.
2. `plan.md`: modelo de datos, endpoints, decisiones y riesgos.
3. `tasks.md`: checklist de tareas pequeñas, cada una con su test.
4. Implementar una tarea a la vez y marcarla `[x]` solo cuando su test pase.
5. No escribir código de una feature sin su spec aprobada. Si cambia el alcance,
   actualizar primero la spec.

Orden: `001-foundation` → `002-tickets` → `003-catalog` → `004-assistant`
→ `005-notifications` → `006-attachments` (+ visión y el diagnóstico de la 009)
→ `009-assistant-skills` (acciones confirmadas) → `007-admin-metrics` (+ copiloto)
→ `008-delivery`.
El índice, el estado y la trazabilidad con el PDF están en `specs/README.md`.
Antes de cada feature, leer `specs/000-overview/`.

## Git y entrega

- Conventional Commits en inglés (`feat(tickets): add status transitions`), un
  commit por tarea.
- No hacer push ni abrir el PR sin que el usuario lo pida.
- Hecho significa:
  - typecheck, lint y tests en verde
  - endpoint documentado en OpenAPI
  - permisos probados
  - tarea marcada en su spec
  - README actualizado si cambian los comandos

## Diseño

Basado en el sistema de PBG Copilot (pbgcopilot.com y la app). La UI va
**solo en español**; el código, los nombres y los commits van en inglés.

- **Tipografía:** Poppins (300–800) con fallback del sistema. Las etiquetas pequeñas
  van en mayúsculas con tracking amplio.
- **Tema claro** (por defecto, como la app Copilot):
  - fondo con degradado gris-azulado suave
  - tarjetas blancas translúcidas con blur
  - bordes finos y sombras suaves
- **Tema oscuro:** tokens del sitio de marketing.
- **Forma:**
  - radios de 12–20 px en tarjetas y 999 px en pills y botones de icono
  - acento primario en botones y estados activos
- **Logo:** no copiar el logo de PBG. Usar wordmark de texto.

| Token | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
Los tokens están en `frontend/src/styles/globals.css`. Nombres de shadcn más algunos
propios.

| Token (clase Tailwind) | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
| `primary` | `#14768c` | `#1fa3c4` | Botones y estados activos (contraste AA con su texto) |
| `brand` | `#1fa3c4` | `#2bbfe0` | Acento de marca: foco, indicadores, iconos |
| `background` | `#f3f7f9` + degradado | `#06151c` | Fondo de la app |
| `card` | `#ffffff` (clase `glass`: 80 % + blur) | `#0a222c` | Tarjetas y paneles |
| `foreground` | `#0b2430` | `#eef3f2` | Texto principal |
| `muted-foreground` | `#5b7480` | `rgba(238,243,242,.62)` | Texto secundario |
| `border` | `#e1eaee` | `rgba(198,193,178,.16)` | Bordes |
| `gold` / `gold-soft` | `#b8913a` / `#f7efd9` | `#d9c186` | Dorado: «En revisión», notas internas |
| `success` / `success-soft` | `#1f9d61` / `#e3f5ec` | `#3ccf8e` | Resuelto o confirmado |
| `destructive` | `#aa151b` | `#ff5a5a` | Errores, prioridad urgente |

Estados de ticket:
- Abierto: `brand`
- En revisión: `gold`
- Cerrado: `success` (o neutro si el cierre es por motivo)

Utilidades propias:
- `.glass`: superficie translúcida.
- `.eyebrow`: etiqueta en mayúsculas.

Nada de colores hex sueltos en los componentes. Un panel siempre oscuro usa la clase
`dark` sobre ese contenedor.

Los tokens se definen como variables CSS en el tema de Tailwind/shadcn; nada de
colores sueltos en los componentes.

## Skills del proyecto

Están en `.agents/skills/` (con symlinks en `.claude/skills/`):

- `fastify-best-practices`: todo el backend.
- `react-vite-best-practices`: el frontend.
- `tanstack-query-best-practices`: el frontend.
- `shadcn`: el frontend. Con pnpm se ejecuta como `pnpm dlx shadcn@latest`.
- `web-design-guidelines`: revisión de UI y accesibilidad antes de cerrar una feature.
- `caveman`: solo cuando el usuario lo pide.
