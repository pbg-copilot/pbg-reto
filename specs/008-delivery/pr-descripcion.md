# Soporte y tickets con IA

Borrador de la descripción del PR `tickets-ia-alex-castro` → `main` (AC-008.7). Título
propuesto: `feat: soporte y tickets con IA (reto PBG)`. El PR no se abre hasta que se
pida.

---

## Resumen

Módulo de soporte para la plataforma RETO:
- un **chat con asistente de IA** (Anthropic `claude-haiku-5-5`) que resuelve problemas
  conocidos desde un catálogo y, si no puede, crea un ticket con el contexto ordenado;
- **tickets** con ciclo Abierto → En revisión → Cerrado, comentarios públicos y notas
  internas, adjuntos privados, reapertura con historial y concurrencia optimista;
- **notificaciones** en la app y por correo (Mailpit) con outbox transaccional y worker
  con reintentos;
- para el equipo: bandeja con filtros, catálogo e incidentes, métricas de atención,
  estado operativo en vivo y un copiloto (resumen, respuesta sugerida, duplicados).

Todo vive en el esquema nuevo `helpdesk`, creado con migraciones. No se modificaron los
esquemas originales, `data/postgres/`, `database/init/` ni el contrato de
`/auth/get-toke`. Los tests del repo base siguen en verde.

## Alcance por spec

| Spec | Qué incluye |
| --- | --- |
| 001 · foundation | Monolito modular con pnpm, Fastify 5 + zod + OpenAPI, Kysely, migraciones, idempotencia, errores comunes, rate limits, cola `helpdesk.jobs` y worker |
| 002 · tickets | Tickets `TCK-000123`, máquina de estados, comentarios y notas internas con revisiones, asignación, prioridades, etiquetas, eventos de auditoría, «sin leer», versión y 409 |
| 003 · catalog | Artículos versionados, publicación y archivo, búsqueda `spanish` + `unaccent` + `pg_trgm`, incidentes, borrador desde un ticket resuelto con datos enmascarados |
| 004 · assistant | Chat con herramientas validadas en el servidor, historial append-only, enmascarado de secretos, escalamiento, «¿Se resolvió?», plan B sin IA y costo por respuesta |
| 005 · notifications | Bandeja persistente, correo por outbox, entregas por canal, reintentos con backoff y reintento manual |
| 006 · attachments | Bucket privado, descarga autorizada por streaming, validación por magic bytes, retiro con trazabilidad, visión con consentimiento |
| 009 · assistant-skills | Diagnóstico de la propia cuenta y acciones propuestas por el asistente que la persona confirma |
| 007 · admin-metrics | TPR, TR, reapertura, cumplimiento por prioridad, costo de IA, estado operativo en vivo y copiloto del equipo |
| 008 · delivery | E2E D1–D6, documentación, verificación final |

## Decisiones

| ADR | Decisión |
| --- | --- |
| 0001 | Esquema nuevo `helpdesk` en lugar del heredado `support.*` (viene de SQLite y un test del repo base congela sus conteos) |
| 0002 | Monolito modular en un workspace de pnpm (`backend`, `frontend`, `packages/shared`) |
| 0003 | Anthropic `claude-haiku-5-5` con proveedor simulado para tests. Costos medidos |
| 0004 | Adjuntos servidos por streaming desde la API, sin URLs firmadas |
| 0005 | Hoja de ruta de IA: MCP, Agent Skills y embeddings diferidos |

Otras decisiones:
- La IA nunca decide identidad, permisos, IDs ni enlaces. Lo que escribe datos se
  propone y la persona lo confirma.
- Un recurso ajeno responde 404, no 403.
- Worker propio sobre PostgreSQL (`FOR UPDATE SKIP LOCKED`), sin Redis: el job se guarda
  en la misma transacción que el cambio. Ver `docs/despliegue-y-escalabilidad.md`.

## Cómo probar

```sh
git switch tickets-ia-alex-castro
cp .env.example .env              # sin API key usa el asistente simulado
docker compose up -d --build      # la primera restauración tarda varios minutos
docker compose ps                 # todo healthy
```

- App: http://localhost:8088 · API: http://localhost:8008 · OpenAPI: http://localhost:8088/docs
- Mailpit: http://localhost:8025 · Consola S3: http://localhost:9001
- Cuentas (contraseña `123456`): `agente099` solicitante, `agente009` admin, `agente016`
  dueño de agencia.
- Para usar Haiku: `AI_PROVIDER=anthropic` y `ANTHROPIC_API_KEY` en `.env`, y después
  `docker compose up -d backend worker`.

```sh
pnpm install
pnpm typecheck && pnpm lint
pnpm test:unit      # Vitest contra el Postgres de compose
pnpm test:ui        # Playwright contra :8088
pnpm test:e2e       # D1–D6 de punta a punta con el asistente simulado
pnpm test           # repo base (cierra la sesión de las cuentas de demo)
```

El guion paso a paso está en el README («Guion de demo») y la guía para presentarlo en
`docs/manual-usuario.md`.

## Casos de demostración (§14)

- [x] **D1** · Consulta conocida resuelta con artículo y confirmación, sin ticket
  (`tests/e2e/d1-known-issue.spec.ts`)
- [x] **D2** · Problema desconocido → ticket Abierto con contexto y enlace; un reintento
  no lo duplica (`d2-escalation.spec.ts`)
- [x] **D3** · El admin revisa, comenta, adjunta y cierra; el solicitante desconectado
  recibe los avisos y los correos llegan a Mailpit (`d3-admin-flow.spec.ts`)
- [x] **D4** · Reapertura con historial; notas internas y sus adjuntos ocultos
  (`d4-reopen.spec.ts`)
- [x] **D5** · Tickets y adjuntos ajenos dan 404, también para el dueño de la agencia;
  la inyección en el chat no amplía permisos (`d5-isolation.spec.ts`)
- [x] **D6** · Caída de la IA con formulario, Mailpit detenido y recuperado, conflicto
  de dos admins (`d6-resilience.spec.ts`)

## Seguridad y datos

- Permisos en tres capas: política, repositorio filtrado por actor y esquema de
  respuesta por rol. Matriz con el test de cada fila en `docs/permisos.md`.
- Las notas internas y sus adjuntos nunca llegan al solicitante, a las notificaciones ni
  al modelo.
- Adjuntos: lista blanca de tipos, 10 MB, magic bytes, `nosniff`, `no-store`, sin el
  nombre original en la clave de S3.
- CSP con nonce. Sin `<script>` ni `<style>` inline.
- Rate limit en login, chat, subidas y copiloto. Logs sin tokens, cookies ni datos
  personales.
- Sin secretos en el repo: solo `.env.example` con valores locales.
- Ningún dato de las tablas originales en seeds, tests, documentos ni prompts. El
  contenido de demo es ficticio y está marcado como ejemplo.

## Costos de IA

- ≈ US$0.00055 por mensaje del chat (medido con prompt caching).
- ≈ US$0.0002 por uso del copiloto.
- ≈ US$0.00015 por imagen compartida con el asistente.

Proyección por número de clientes en `docs/costos-ia.md`. El costo real del rango se ve
en `/admin/metricas`.

## Límites conocidos

- Las notificaciones se actualizan por polling cada 20 s; no hay tiempo real.
- El correo es *at-least-once*: en un corte justo después de enviar, se repite con el
  mismo `Message-ID`.
- Haiku no tiene fallback del servidor ante `refusal`; el chat ofrece el formulario.
- El rate limit cuenta en memoria por instancia (ver la sección de escalabilidad).
- El hilo de comentarios de un ticket se carga completo.
- La cuenta de test `agente048` figura cancelada en la réplica; los tests lo tienen en
  cuenta.

## Trabajo futuro

- SSE para notificaciones y cambios de tickets.
- Proveedor de correo real (SES o Resend) y antivirus para adjuntos (ClamAV).
- Purga de binarios retirados, archivado de tickets viejos y agregados de métricas.
- `pnpm eval:assistant` con escenarios y costo.
- MCP de solo lectura para el equipo y embeddings si el catálogo crece (ADR 0005).
- Fusionar duplicados, horario laboral en las métricas y preferencias de notificación.

Lista completa en `specs/BACKLOG.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
