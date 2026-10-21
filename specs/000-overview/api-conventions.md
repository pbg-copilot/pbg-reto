# Convenciones de la API

Aplican a todos los endpoints nuevos. Los tres endpoints de auth del repo base
mantienen su contrato.

## Prefijos y proxies

| Prefijo | Uso |
| --- | --- |
| `/auth` | Login, sesión y logout (repo base) |
| `/health` | Estado de la API y la base |
| `/support` | Conversaciones, artículos, incidentes, métricas y prioridades |
| `/tickets` | Tickets, comentarios, adjuntos, estado, asignación y reapertura |
| `/attachments` | Descarga y retiro de adjuntos |
| `/notifications` | Bandeja de notificaciones |
| `/docs` | OpenAPI (`/docs` muestra la UI y `/docs/json` el documento) |

**En el navegador la API vive bajo `/api/…`.** nginx (`frontend/nginx.conf`) y Vite
(`frontend/vite.config.ts`) quitan ese prefijo al reenviar, así que el backend
expone exactamente estas rutas. Esto evita que las pantallas de la app
(`/tickets/:id`) choquen con la API (`/tickets/:id`) al recargar o al abrir un
enlace. `/auth`, `/health` y `/docs` también se sirven sin prefijo, por
compatibilidad con el repo base.

## Autenticación y origen

- La sesión llega por la cookie `reto_session` (HttpOnly, SameSite=Lax) o por
  `Authorization: Bearer <token>`. Sin sesión válida la API responde 401
  `unauthorized`.
- `APP_ORIGIN` acepta una lista separada por comas. Un `Origin` que no esté en la
  lista responde 403 `origin_not_allowed`; `tests/api.test.mjs` lo verifica.
- El rol se lee de la base en cada request. Nunca se toma del cliente.

## Formato de error

```json
{ "error": "version_conflict", "message": "El ticket cambió mientras lo editabas.", "details": { "current": { } } }
```

| HTTP | `error` | Cuándo |
| --- | --- | --- |
| 400 | `invalid_request` | Falla la validación de zod. `details.fields` trae `{ campo: mensaje }` |
| 401 | `unauthorized` | No hay sesión o expiró |
| 403 | `forbidden` | El recurso es visible pero el rol no permite la acción |
| 403 | `origin_not_allowed` | El origen no está permitido |
| 404 | `not_found` | El recurso no existe o no es visible para el actor |
| 409 | `version_conflict` | `version` desactualizada. `details.current` trae el recurso actual |
| 409 | `idempotency_in_progress` | La misma clave está en proceso |
| 409 | `ticket_closed` | Se intenta comentar un ticket cerrado (hay que reabrirlo) |
| 409 | `conversation_already_escalated` | La conversación ya tiene un ticket. `details.ticket` lo incluye |
| 413 | `file_too_large` | El adjunto supera el límite |
| 415 | `unsupported_file_type` | Tipo de archivo no permitido o que no coincide con su contenido |
| 422 | `invalid_transition` | La transición de estado no está permitida |
| 422 | `resolution_required` | Falta el motivo o el resumen al cerrar |
| 422 | `idempotency_key_reused` | La misma clave llega con otro cuerpo |
| 429 | `too_many_requests` | Se superó el rate limit |
| 503 | `assistant_unavailable` | La IA falló o se agotó el tiempo. El mensaje del usuario queda guardado |
| 500 | `internal_error` | Error inesperado. Se registra en el log sin datos personales |

`message` siempre va en español y se puede mostrar en la UI tal cual.

## Validación y serialización

- Cada ruta declara `body`, `querystring`, `params` y `response` con zod mediante
  `fastify-type-provider-zod`.
- El esquema de `response` filtra los campos: lo que no está declarado no sale. Hay
  esquemas distintos para el solicitante y el admin.
- Los esquemas viven en `packages/shared` y los usa también el frontend.

## Paginación, filtros y orden

- Query: `page` (desde 1), `page_size` (por defecto 20, máximo 50).
- Respuesta: `{ "items": [...], "page": 1, "page_size": 20, "total": 134 }`.
- Orden: `sort` (campo de una lista blanca) y `order` (`asc` | `desc`).
- Los filtros se describen en cada spec. Un valor desconocido responde 400.

## Idempotencia

- Header `Idempotency-Key`: 8 a 128 caracteres (`[A-Za-z0-9_-]`). El cliente genera
  un UUID por intención del usuario y lo reutiliza en los reintentos.
- Es obligatorio en:
  - `POST /support/conversations`
  - `POST /support/conversations/:id/messages`
  - `POST /support/conversations/:id/escalate`
  - `POST /tickets`
  - `POST /tickets/:id/comments`
  - `POST /tickets/:id/attachments`
  - `POST /support/conversations/:id/attachments`
  - `POST /tickets/:id/reopen`
- Se guarda en `helpdesk.idempotency_keys` con clave `(account_id, key)`, junto con
  el método, la ruta, el hash del cuerpo, el estado y la respuesta.
  - Si la clave ya existe y está `completed` con el mismo hash, se devuelve la misma
    respuesta (status y body) y el header `Idempotent-Replayed: true`.
  - Si la clave existe con otro hash, responde 422 `idempotency_key_reused`.
  - Si la clave está `in_progress`, responde 409 `idempotency_in_progress`.
- Las claves expiran a las 24 h; el worker las limpia.
- Además hay restricciones únicas en la base como segunda barrera. Por ejemplo, un
  ticket por conversación (`tickets.conversation_id` único).

## Concurrencia optimista

- Los recursos mutables (`tickets`, `articles`) exponen `version`, un entero.
- `PATCH /tickets/:id/status`, `PATCH /tickets/:id/assignee`, `PATCH /tickets/:id` y
  `POST /tickets/:id/reopen` exigen `version` en el body.
- La actualización se hace con `UPDATE … WHERE id = $1 AND version = $2`. Si afecta
  0 filas, responde 409 `version_conflict` con el recurso actual, y la UI muestra el
  conflicto y deja reintentar.

## Rate limits (por cuenta)

| Ruta | Límite |
| --- | --- |
| `POST /auth/get-toke` | 15 por minuto (repo base, por IP) |
| `POST /support/conversations/:id/messages` | 20 por minuto |
| Subida de adjuntos | 20 por minuto |
| Resto de mutaciones | 120 por minuto |

## Índice de endpoints

| Método y ruta | Rol | Spec |
| --- | --- | --- |
| `GET /health` | público | base |
| `POST /auth/get-toke` · `GET /auth/me` · `POST /auth/logout` | base | base |
| `POST /support/conversations` | sesión | 004 |
| `GET /support/conversations` (las propias, recientes) | sesión | 004 |
| `GET /support/conversations/:id` | dueño o admin | 004 |
| `POST /support/conversations/:id/messages` | dueño | 004 |
| `POST /support/conversations/:id/resolution` | dueño | 004 |
| `POST /support/conversations/:id/escalate` | dueño | 004 |
| `POST /support/conversations/:id/attachments` | dueño | 006 |
| `GET /support/articles` · `GET /support/articles/:idOrSlug` | sesión (admin ve borradores) | 003 |
| `POST /support/articles` · `POST /support/articles/:id/versions` | admin | 003 |
| `POST /support/articles/:id/publish` · `POST /support/articles/:id/archive` | admin | 003 |
| `POST /support/articles/from-ticket/:ticketId` | admin | 003 |
| `GET /support/incidents` · `POST /support/incidents` · `PATCH /support/incidents/:id` | sesión (lectura) / admin | 003 |
| `GET /support/categories` · `GET /support/priorities` | sesión | 002 |
| `PATCH /support/priorities/:code` | admin | 007 |
| `GET /support/admins` | admin | 002 |
| `GET /support/metrics` | admin | 007 |
| `POST /tickets` · `GET /tickets` | sesión | 002 |
| `GET /tickets/:id` | dueño o admin | 002 |
| `PATCH /tickets/:id` (prioridad, categoría, etiquetas) | admin | 002 |
| `PATCH /tickets/:id/status` · `PATCH /tickets/:id/assignee` | admin | 002 |
| `POST /tickets/:id/reopen` | dueño o admin | 002 |
| `POST /tickets/:id/comments` · `PATCH /tickets/:id/comments/:commentId` | dueño o admin (las notas internas solo admin) | 002 |
| `POST /tickets/:id/attachments` | dueño o admin | 006 |
| `GET /attachments/:id/download` · `DELETE /attachments/:id` | según visibilidad / admin | 006 |
| `GET /notifications` · `GET /notifications/unread-count` | sesión | 005 |
| `PATCH /notifications/:id/read` · `POST /notifications/read-all` | dueño | 005 |
