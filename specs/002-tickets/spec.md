# 002 · Tickets

- **Estado:** Hecha (2026-10-20)
- **Prioridad:** Must
- **PDF:** §04, §05, §06, §07 (gestión básica), §09 (historial)
- **Depende de:** 001
- **Habilita:** 004, 005, 006, 007

## Problema

El sistema necesita un ciclo de atención claro, con tres estados, permisos estrictos,
historial auditable y sin pérdidas ni duplicados cuando hay reintentos o dos admins
editando a la vez.

## Historias

**Solicitante**
- Quiero ver "Mis tickets" con vistas Abiertos, En revisión y Cerrados, buscar,
  filtrar, ordenar y paginar, y distinguir lo que no he leído.
- Quiero abrir un ticket desde el enlace del chat o desde la lista y ver descripción,
  comentarios, evidencias, historial, resolución y estado actual.
- Quiero responder con comentarios públicos y reabrir un ticket cerrado si el
  problema vuelve.
- Quiero crear un ticket con un formulario aunque la IA no esté disponible.

**Administrador**
- Quiero ver los tickets de todos los solicitantes y filtrarlos por estado,
  prioridad, categoría, responsable y antigüedad.
- Quiero tomar un caso (En revisión), asignar un responsable, comentar en público,
  dejar notas internas y cerrarlo con un resumen o un motivo.
- Si otro admin cambió el ticket antes que yo, quiero ver el conflicto y decidir sin
  perder lo que escribí.

## Criterios de aceptación

**Creación**

| ID | Criterio |
| --- | --- |
| AC-002.1 | `POST /tickets` con `Idempotency-Key` crea un ticket en estado `open` con número visible `TCK-NNNNNN`. El solicitante sale de la sesión, nunca del body. Un reintento con la misma clave devuelve el mismo ticket (D2) |
| AC-002.2 | El ticket guarda por separado el reporte original (`original_description`, sin cambios) y `ai_summary`, que puede ser nulo. La UI muestra ambos claramente diferenciados |
| AC-002.3 | Tiene título, descripción, solicitante, categoría, impacto, prioridad, estado, responsable opcional, `created_at`, `updated_at`, conversación de origen opcional, pasos intentados (lista de paso, resultado y artículo opcional), adjuntos y registro de eventos |

**Listado y detalle**

| ID | Criterio |
| --- | --- |
| AC-002.4 | `GET /tickets` filtra por actor: el solicitante ve solo los suyos, aunque comparta agencia (`agente048` no ve los de `agente049` ni al revés), y el admin ve todos |
| AC-002.5 | `GET /tickets` acepta `view=open|in_review|closed`, `q` (número, título o descripción), `category`, `priority`, `assignee` (`me`, `unassigned` o un id; solo admin), `requester` (solo admin), `age` (`gt_24h`, `gt_72h`, `gt_7d`), `unread=true`, `sort` (`updated_at`, `created_at`, `priority`, `number`), `order`, `page` y `page_size` |
| AC-002.6 | Cada ítem del listado trae `unread` y `last_activity_at`. Para el solicitante solo cuenta la actividad pública: una nota interna nunca marca un ticket como no leído para él |
| AC-002.7 | `GET /tickets/:id` de un ticket ajeno responde 404. El detalle trae el ticket, los comentarios, los adjuntos y los eventos que el actor puede ver, y marca el ticket como leído |

**Comentarios**

| ID | Criterio |
| --- | --- |
| AC-002.8 | `POST /tickets/:id/comments`: el solicitante solo crea comentarios públicos; si intenta una nota interna recibe 403. El admin crea públicos o internos y puede marcar `requests_info` (solicitud de información) |
| AC-002.9 | Comentar un ticket cerrado responde 409 `ticket_closed`. La UI ofrece reabrirlo |
| AC-002.10 | Las notas internas, sus eventos y sus adjuntos **no aparecen** en ninguna respuesta para el solicitante: listado, detalle, historial ni contadores (D4) |
| AC-002.11 | Editar un comentario propio (`PATCH /tickets/:id/comments/:commentId`) guarda la versión anterior en `ticket_comment_revisions`, registra el evento y muestra "editado". *Should* |

**Estados**

| ID | Criterio |
| --- | --- |
| AC-002.12 | `PATCH /tickets/:id/status` (solo admin) aplica las reglas de `000-overview/domain.md`. Pedir el mismo estado responde 200 sin evento. Una transición inválida responde 422 `invalid_transition`. Cerrar sin el motivo o el resumen requerido responde 422 `resolution_required` |
| AC-002.13 | `POST /tickets/:id/reopen` (dueño o admin) pasa de `closed` a `open`, incrementa `reopened_count`, conserva el historial, exige `reason` y crea un evento `reopened` |
| AC-002.14 | Cada mutación exige `version`. Si dos admins cambian el estado o la asignación con la misma versión, uno recibe 200 y el otro 409 `version_conflict` con el ticket actual. La UI muestra el conflicto y conserva lo que el admin escribió (D6) |
| AC-002.15 | `PATCH /tickets/:id/assignee` solo acepta cuentas admin o `null`. `PATCH /tickets/:id` cambia prioridad, categoría y etiquetas. Todo cambio genera su evento |

**Eventos y notificaciones**

| ID | Criterio |
| --- | --- |
| AC-002.16 | Todo cambio de estado, asignación, prioridad, categoría, comentario, adjunto o reapertura crea un `ticket_event` **en la misma transacción**, con `visibility` pública o interna |
| AC-002.17 | El registro de eventos expone un punto de extensión (`recordEvent(tx, event)`) que 005 usa para crear notificaciones en la misma transacción |

**Interfaz**

| ID | Criterio |
| --- | --- |
| AC-002.18 | La UI de "Mis tickets" tiene pestañas Abiertos, En revisión y Cerrados con contador, búsqueda, filtros, orden y paginación; los tickets no leídos van destacados y hay una sección de "actualizaciones recientes" |
| AC-002.19 | El detalle muestra descripción (reporte original y resumen IA separados), pasos intentados, comentarios con su visibilidad marcada, evidencias, historial con fecha y autor, estado actual con su badge y, si está cerrado, la resolución |
| AC-002.20 | Hay un formulario manual "Crear ticket" (título, descripción, categoría e impacto) en `/tickets/nuevo` y como alternativa dentro del chat. Funciona sin IA |
| AC-002.21 | La bandeja del admin incluye responsable, prioridad, tiempo desde la última respuesta e indicador "sin atender" (sin primera respuesta pública del equipo) |

## Fuera de alcance

- Adjuntos: binarios y validación (006).
- Notificaciones (005).
- Métricas y configuración de prioridades (007).
- Fusionar tickets duplicados: solo se guarda `duplicate_of_ticket_id`.
