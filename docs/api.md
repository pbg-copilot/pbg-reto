# API de soporte y tickets

Guía de uso de la API. El contrato completo y siempre actualizado está en OpenAPI:

- UI: http://localhost:8088/docs
- JSON: http://localhost:8088/docs/json (o `:8008/docs/json`)

Cada ruta declara con zod su `body`, `querystring`, `params` y `response`, y de ahí sale
ese documento. Los esquemas viven en `packages/shared` y los usa también el frontend.

## Direcciones

| Desde | Base | Ejemplo |
| --- | --- | --- |
| La app en el navegador | `http://localhost:8088/api` | `/api/tickets` |
| `curl`, Postman, tests | `http://localhost:8008` | `/tickets` |

nginx (y Vite en desarrollo) quitan el prefijo `/api`, así que el backend expone las
rutas del enunciado tal cual. Así la pantalla `/tickets/:id` no choca con la ruta de la
API `/tickets/:id` al recargar. `/auth`, `/health` y `/docs` también responden sin
prefijo, por compatibilidad con el repo base.

## Autenticación

El login es el del repo base y no cambió su contrato.

```sh
API=http://localhost:8008
TOKEN=$(curl -s $API/auth/get-toke -H 'Content-Type: application/json' \
  -d '{"usuario":"agente099","contrasena":"123456"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
AUTH="Authorization: Bearer $TOKEN"
key() { node -p "crypto.randomUUID()"; }   # una Idempotency-Key nueva por intención
```

- La sesión llega por la cookie HttpOnly `reto_session` (la app) o por
  `Authorization: Bearer <token>` (`curl`).
- Hay **una sola sesión activa por cuenta**: iniciar sesión desde `curl` cierra la sesión
  de esa cuenta en el navegador.
- El rol se lee de la base en cada request (`reto.sessions` + `reto.agents`). Nunca se
  toma del cliente.
- Si la request trae un `Origin` que no está en `APP_ORIGIN`, la API responde 403
  `origin_not_allowed`. `curl` no envía `Origin`, así que no le afecta.

## Formato de error

Todas las respuestas de error tienen la misma forma. `message` va en español y se
puede mostrar tal cual en la UI.

```json
{
  "error": "version_conflict",
  "message": "El ticket cambió mientras lo editabas.",
  "details": { "current": { "id": "…", "version": 4, "status": "in_review" } }
}
```

| HTTP | `error` | Cuándo |
| --- | --- | --- |
| 400 | `invalid_request` | Falla la validación. `details.fields` trae `{ campo: mensaje }`. También si falta `Idempotency-Key` donde es obligatorio |
| 401 | `unauthorized` · `invalid_credentials` | No hay sesión, expiró, o el login es incorrecto |
| 403 | `forbidden` | El recurso se ve, pero el rol no permite la acción (por ejemplo, un solicitante que cambia el estado de su ticket) |
| 403 | `origin_not_allowed` | El `Origin` no está en `APP_ORIGIN` |
| 404 | `not_found` | No existe **o no es visible para el actor**. Un ticket o adjunto ajeno responde 404, no 403, para no revelar que existe |
| 409 | `version_conflict` | La `version` enviada está desactualizada. `details.current` trae el recurso actual |
| 409 | `ticket_closed` | Se intenta comentar o adjuntar evidencia pública en un ticket cerrado. Hay que reabrirlo |
| 409 | `conversation_already_escalated` | La conversación ya tiene ticket. `details.ticket` lo incluye |
| 409 | `invalid_transition` | Una acción que ya no aplica: propuesta vencida o cancelada, reintento de un correo que no falló, descartar un artículo publicado |
| 409 | `idempotency_in_progress` | La misma `Idempotency-Key` todavía se está procesando |
| 413 | `file_too_large` | El adjunto supera `UPLOAD_MAX_BYTES` (10 MB por defecto) |
| 415 | `unsupported_file_type` | Tipo no admitido o que no coincide con su contenido real |
| 422 | `invalid_transition` | La transición de estado no está permitida (por ejemplo `open → closed` como «Resuelto») |
| 422 | `resolution_required` | Falta el motivo o el resumen al cerrar |
| 422 | `idempotency_key_reused` | La misma clave llega con otro cuerpo |
| 429 | `too_many_requests` | Se superó el rate limit |
| 503 | `assistant_unavailable` | La IA falló o se agotó el tiempo. El mensaje del usuario queda guardado y la UI ofrece el formulario |
| 500 | `internal_error` | Error inesperado. El log no lleva tokens, cookies ni datos personales |

## Paginación, filtros y orden

- Query: `page` (desde 1) y `page_size` (20 por defecto, máximo 50).
- Respuesta:

  ```json
  { "items": [], "page": 1, "page_size": 20, "total": 134 }
  ```

- Orden en `GET /tickets`: `sort` (`updated_at`, `created_at`, `number`, `priority`) y
  `order` (`asc` | `desc`).
- Un valor fuera de la lista blanca responde 400.

Filtros de `GET /tickets`:

| Filtro | Quién | Qué hace |
| --- | --- | --- |
| `view` | todos | `open`, `in_review` o `closed` |
| `q` | todos | Número (`TCK-000123` o `123`), o texto en título y descripción, sin importar tildes |
| `category`, `priority` | todos | Código del catálogo |
| `unread` | todos | Solo tickets con novedades sin leer |
| `age` | todos | `gt_24h`, `gt_72h`, `gt_7d` |
| `assignee` | admin | `me`, `unassigned` o el id de un admin |
| `requester` | admin | Id del solicitante |
| `unattended` | admin | Abiertos sin primera respuesta pública del equipo |
| `waiting` | admin | `team`: el solicitante respondió y el equipo no. `requester`: se pidió información y no hubo respuesta |

El solicitante solo ve sus tickets, con cualquier filtro. Los filtros de admin que mande
un solicitante no amplían lo que ve.

## Idempotencia

Los POST que crean algo o tienen efectos aceptan el header `Idempotency-Key`. En los
siguientes es **obligatorio**:

- `POST /tickets`, `/tickets/:id/comments`, `/tickets/:id/attachments`, `/tickets/:id/reopen`;
- `POST /support/conversations`, `/support/conversations/:id/messages`,
  `/support/conversations/:id/resolution`, `/support/conversations/:id/escalate`,
  `/support/conversations/:id/attachments`.

Reglas:
- Formato: entre 8 y 128 caracteres de `[A-Za-z0-9_-]`. El cliente genera un UUID por
  **intención** del usuario y lo reutiliza en cada reintento.
- Las claves son por cuenta: la misma clave de otra persona no choca.

| Si llega… | La API responde |
| --- | --- |
| La misma clave con el mismo cuerpo, ya completada | La misma respuesta guardada (status y body), con el header `Idempotent-Replayed: true`. No se crea nada nuevo |
| La misma clave con otro cuerpo | 422 `idempotency_key_reused` |
| La misma clave mientras la primera sigue en curso | 409 `idempotency_in_progress` |
| Un 5xx en el primer intento | No se guarda, para que el reintento se procese de nuevo |

- Las claves expiran a las 24 h y el worker las limpia.
- La base tiene restricciones únicas como segunda barrera: por ejemplo, un ticket por
  conversación.

## Concurrencia optimista

Los tickets y los artículos tienen `version`, un entero que sube con cada cambio.

- `PATCH /tickets/:id`, `PATCH /tickets/:id/status`, `PATCH /tickets/:id/assignee` y
  `POST /tickets/:id/reopen` exigen la `version` que el cliente tiene en pantalla.
- La actualización es `UPDATE … WHERE id = $1 AND version = $2`. Si otro admin cambió
  el ticket antes, responde 409 `version_conflict` con el ticket actual en
  `details.current`. La UI muestra el conflicto y ofrece aplicar el cambio sobre la
  versión nueva.
- Pedir el estado que el ticket ya tiene responde 200 sin crear evento.

## Rate limits

| Ruta | Límite | Clave |
| --- | --- | --- |
| `POST /auth/get-toke` | 15 por minuto | IP (repo base) |
| `POST /support/conversations/:id/messages` y `/resolution` | 20 por minuto | Sesión |
| Subida de adjuntos | 20 por minuto | Sesión |
| Copiloto (resumen y borrador) | 10 por minuto | Sesión |
| Resto de mutaciones | 120 por minuto | Sesión |

Al superarlo responde 429 `too_many_requests`. Los contadores viven en la memoria de
cada instancia de la API (ver `docs/despliegue-y-escalabilidad.md` para varias
instancias).

## Ejemplos

Usan las variables `API` y `AUTH` de la sección de autenticación. `jq` es opcional.

### Tickets

```sh
# Crear un ticket con el formulario (el solicitante sale de la sesión, nunca del body)
curl -s $API/tickets -H "$AUTH" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(key)" \
  -d '{"title":"No carga el reporte de ventas","description":"Al abrir Reportes la pantalla queda en blanco.","category":"screens","impact":"medium"}'
# → 201 { "id": "…", "number": 123, "display_number": "TCK-000123", "status": "open", "version": 1, … }

# Listar mis tickets abiertos, del más reciente al más antiguo
curl -s "$API/tickets?view=open&page=1&page_size=20" -H "$AUTH"

# Detalle con historial (el solicitante nunca recibe notas internas)
curl -s $API/tickets/$TICKET_ID -H "$AUTH"

# Comentar (público por defecto)
curl -s $API/tickets/$TICKET_ID/comments -H "$AUTH" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(key)" -d '{"body":"Adjunto la captura del error."}'

# Reabrir un ticket cerrado, con motivo y la versión actual
curl -s $API/tickets/$TICKET_ID/reopen -H "$AUTH" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(key)" -d '{"version":4,"reason":"Volvió a pasar hoy."}'
```

Con una sesión de admin:

```sh
# Bandeja: tickets que esperan respuesta del equipo
curl -s "$API/tickets?waiting=team" -H "$AUTH"

# Nota interna (solo la ve el equipo y no genera avisos al solicitante)
curl -s $API/tickets/$TICKET_ID/comments -H "$AUTH" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(key)" -d '{"body":"Revisar el log del exportador.","visibility":"internal"}'

# Cambiar estado (en_review → closed exige resumen)
curl -s -X PATCH $API/tickets/$TICKET_ID/status -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"status":"in_review","version":1}'
curl -s -X PATCH $API/tickets/$TICKET_ID/status -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"status":"closed","version":2,"closure_reason":"resolved","resolution_summary":"Se corrigió el filtro de fechas."}'

# Cerrar desde Abierto por duplicado
curl -s -X PATCH $API/tickets/$TICKET_ID/status -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"status":"closed","version":1,"closure_reason":"duplicate","duplicate_of_number":120}'

# Asignar, cambiar prioridad o etiquetas
curl -s -X PATCH $API/tickets/$TICKET_ID/assignee -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"version":3,"assignee_id":"<id de un admin de GET /support/admins>"}'
curl -s -X PATCH $API/tickets/$TICKET_ID -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"version":4,"priority":"high","tags":["exportar"]}'
```

### Adjuntos

```sh
# Subir evidencia (multipart). Campos opcionales: visibility (solo admin) y comment_id
curl -s $API/tickets/$TICKET_ID/attachments -H "$AUTH" -H "Idempotency-Key: $(key)" \
  -F 'files=@captura.png;type=image/png'
# → 201 { "attachments": [{ "id": "…", "original_name": "captura.png", "visibility": "public", … }] }

# Descargar (la API autoriza cada request y sirve el archivo por streaming)
curl -s -OJ $API/attachments/$ATTACHMENT_ID/download -H "$AUTH"

# Retirar (solo admin, con motivo; queda la trazabilidad)
curl -s -X DELETE $API/attachments/$ATTACHMENT_ID -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"reason":"Contenía datos de otra persona."}'
```

### Chat de soporte

```sh
# Nueva conversación y un mensaje al asistente
CONV=$(curl -s -X POST $API/support/conversations -H "$AUTH" -H "Idempotency-Key: $(key)" | jq -r .id)
curl -s $API/support/conversations/$CONV/messages -H "$AUTH" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(key)" -d '{"text":"No puedo iniciar sesión, me dice credenciales inválidas"}'
# → { "user_message": { … }, "assistant_message": { "text": "…", "article_refs": [{ "id": "…", "version": 1, … }], "ticket_ref": null, … },
#     "ask_resolution": true, "conversation": { … } }

# «Sí, se resolvió» con el artículo usado
curl -s $API/support/conversations/$CONV/resolution -H "$AUTH" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(key)" -d '{"resolved":true,"article_id":"<id del artículo>"}'

# «Hablar con una persona»: crea el ticket sin pasar por la IA
curl -s $API/support/conversations/$CONV/escalate -H "$AUTH" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(key)" -d '{"note":"Prefiero que lo revise alguien del equipo."}'

# Confirmar una propuesta del asistente (comentar o reabrir uno de mis tickets)
curl -s -X POST $API/support/conversations/$CONV/actions/$ACTION_ID/confirm -H "$AUTH"
```

### Catálogo, notificaciones y métricas

```sh
curl -sG $API/support/articles --data-urlencode "q=contraseña" -H "$AUTH"   # sin importar tildes ni errores de tipeo
curl -s "$API/support/incidents?active=true" -H "$AUTH"           # incidentes conocidos (campos públicos)
curl -s $API/notifications/unread-count -H "$AUTH"                # contador de la campana
curl -s -X POST $API/notifications/read-all -H "$AUTH"
curl -s "$API/support/metrics?from=2026-10-01&to=2026-10-22" -H "$AUTH"   # solo admin
curl -s $API/support/metrics/operations -H "$AUTH"                         # solo admin
```

## Índice de endpoints

### Base y sesión

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `GET /health` | público | Estado de la API y de PostgreSQL |
| `POST /auth/get-toke` | público | Iniciar sesión (`usuario`, `contrasena`) |
| `GET /auth/me` | sesión | Sesión actual |
| `POST /auth/logout` | sesión | Cerrar sesión |

### Tickets

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `POST /tickets` | sesión | Crear ticket con el formulario |
| `GET /tickets` | sesión | Listar (el solicitante, solo los suyos) |
| `GET /tickets/:id` | dueño o admin | Detalle, historial y resolución |
| `PATCH /tickets/:id` | admin | Prioridad, categoría, etiquetas, incidente |
| `PATCH /tickets/:id/status` | admin | Cambiar estado |
| `PATCH /tickets/:id/assignee` | admin | Asignar responsable |
| `POST /tickets/:id/reopen` | dueño o admin | Reabrir un ticket cerrado |
| `POST /tickets/:id/comments` | dueño o admin | Comentar (las notas internas, solo admin) |
| `PATCH /tickets/:id/comments/:commentId` | autor | Corregir un comentario propio; queda la versión anterior |
| `GET /tickets/:id/deliveries` | admin | Estado de entrega de los avisos por canal |
| `POST /notifications/deliveries/:id/retry` | admin | Reintentar un correo fallido |

### Adjuntos

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `POST /tickets/:id/attachments` | dueño o admin | Adjuntar archivos a un ticket |
| `POST /support/conversations/:id/attachments` | dueño | Adjuntar evidencias en el chat |
| `GET /attachments/:id/download` | según visibilidad | Descargar (autorizado en cada request, por streaming) |
| `DELETE /attachments/:id` | admin | Retirar una evidencia |

### Chat de soporte

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `POST /support/conversations` | sesión | Nueva conversación |
| `GET /support/conversations` | sesión | Mis conversaciones recientes |
| `GET /support/conversations/:id` | dueño o admin (lectura) | Conversación con su historial |
| `POST /support/conversations/:id/messages` | dueño | Enviar un mensaje al asistente |
| `POST /support/conversations/:id/resolution` | dueño | «¿Se resolvió?» Sí o No |
| `POST /support/conversations/:id/escalate` | dueño | Hablar con una persona (ticket sin IA) |
| `POST /support/conversations/:id/actions/:actionId/confirm` | dueño | Confirmar una propuesta del asistente |
| `POST /support/conversations/:id/actions/:actionId/cancel` | dueño | Cancelar una propuesta |

### Catálogo e incidentes

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `GET /support/articles` | sesión (el admin ve borradores) | Buscar artículos |
| `GET /support/articles/:idOrSlug` | sesión | Leer un artículo |
| `GET /support/articles/:id/manage` | admin | Gestión: versiones y estado |
| `POST /support/articles` | admin | Crear artículo (borrador) |
| `POST /support/articles/:id/versions` | admin | Nueva versión (las versiones son inmutables) |
| `POST /support/articles/:id/publish` · `/archive` | admin | Publicar una versión o archivar |
| `DELETE /support/articles/:id` | admin | Descartar un borrador que nunca se publicó |
| `POST /support/articles/from-ticket/:ticketId` | admin | Borrador desde un ticket resuelto |
| `GET /support/incidents` | sesión | Incidentes conocidos |
| `POST /support/incidents` · `PATCH /support/incidents/:id` | admin | Registrar o actualizar un incidente |

### Catálogos, métricas y copiloto

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `GET /support/categories` · `GET /support/priorities` | sesión | Catálogos (el solicitante no ve objetivos) |
| `PATCH /support/priorities/:code` | admin | Configurar objetivos de una prioridad |
| `GET /support/admins` | admin | Admins asignables con su carga |
| `GET /support/metrics` | admin | Métricas de atención del rango |
| `GET /support/metrics/operations` | admin | Estado operativo en vivo |
| `POST /tickets/:id/copilot/summary` | admin | Resumir el caso |
| `POST /tickets/:id/copilot/reply-draft` | admin | Sugerir una respuesta pública (nunca se envía sola) |
| `GET /tickets/:id/similar` | admin | Posibles duplicados (sin IA) |

### Notificaciones

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `GET /notifications` | sesión | Bandeja (solo las propias) |
| `GET /notifications/unread-count` | sesión | Contador de la campana |
| `PATCH /notifications/:id/read` | dueño | Marcar como leída |
| `POST /notifications/read-all` | sesión | Marcar todas como leídas |

Quién puede hacer qué, con el test que lo comprueba: [`docs/permisos.md`](permisos.md).
