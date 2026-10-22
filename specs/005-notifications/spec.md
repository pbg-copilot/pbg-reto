# 005 · Notificaciones

- **Estado:** Hecha (2026-10-21)
- **Prioridad:** Must
- **PDF:** §06, §08
- **Depende de:** 001 (jobs), 002 (`recordEvent`)

## Problema

Cada cambio relevante del ticket debe llegar a la persona correcta aunque no esté
conectada. No se puede perder ni duplicar por fallos, y nunca debe filtrar
información interna.

## Historias

- Como solicitante, quiero recibir una notificación persistente con el número de
  ticket, el estado anterior, el nuevo, la fecha y el enlace cada vez que cambie el
  estado. También cuando se crea el ticket, cuando el equipo comenta en público o
  cuando me pide información.
- Como solicitante, quiero una campana con contador, una bandeja con leídas y no
  leídas, y poder marcarlas como leídas.
- Como admin, quiero enterarme cuando un solicitante responde o reabre un caso.

## Eventos y destinatarios

| Evento (002) | Destinatario | Canales |
| --- | --- | --- |
| `created` | Solicitante (confirmación); equipo: responsable o, si no hay, todos los admins | in_app (+ email al solicitante) |
| `status_changed` | Solicitante | in_app + email |
| `comment_added` público de un admin | Solicitante | in_app + email |
| `comment_added` público con `requests_info` | Solicitante (tipo "Solicitud de información") | in_app + email |
| `comment_added` público del solicitante | Equipo | in_app |
| `reopened` | Solicitante y equipo | in_app (+ email al solicitante) |
| `assigned` (interno) | El nuevo responsable, si no se asignó a sí mismo | in_app |
| Notas internas y cualquier evento `internal` | **Nadie fuera del equipo**; no generan notificación al solicitante | — |

El actor que provoca el evento no se notifica a sí mismo. La única excepción es la
confirmación de creación al solicitante («Recibimos tu ticket»).

«Equipo» significa el responsable del ticket o, si no tiene, todos los admins.

## Criterios de aceptación

| ID | Criterio |
| --- | --- |
| AC-005.1 | Cada transición guardada crea, **en la misma transacción**, una notificación persistente para el solicitante con `display_number`, `from`, `to`, fecha y enlace `/tickets/:id`. Si la transacción del cambio falla, no queda ninguna notificación (D3) |
| AC-005.2 | También se notifican la creación, los comentarios públicos del equipo y las solicitudes de información. El equipo recibe aviso cuando el usuario responde o reabre |
| AC-005.3 | Ni el contenido ni la existencia de notas internas aparecen en las notificaciones. El cuerpo de un comentario público se recorta a 140 caracteres |
| AC-005.4 | Las notificaciones persisten aunque el usuario no esté conectado: al iniciar sesión más tarde aparecen como no leídas (D3) |
| AC-005.5 | `GET /notifications` (paginado, filtro `unread`), `GET /notifications/unread-count`, `PATCH /notifications/:id/read` y `POST /notifications/read-all` operan solo sobre las propias; una ajena da 404 |
| AC-005.6 | La campana muestra el contador con polling cada 20 s y al recuperar el foco. La bandeja permite marcar leída. Abrir una notificación navega al enlace, donde la API **vuelve a verificar permisos** (si ya no hay acceso, 404 con un mensaje amable) |
| AC-005.7 | Cada notificación tiene una entrega por canal en `notification_deliveries`. `in_app` queda `delivered` al confirmarse la transacción. `email` nace como `pending` y la procesa el worker |
| AC-005.8 | El worker envía el correo a **Mailpit** (buzón local, nunca correos reales) con reintentos y backoff exponencial. Solo se envía a dominios de `MAIL_ALLOWED_DOMAINS` (por defecto `reto.example`); otro dominio deja la entrega `failed` sin intentar el envío. Si se agotan los intentos queda `failed` con `last_error`. Si Mailpit está detenido y luego vuelve, la entrega termina en `delivered` sin duplicados de notificación (D6) |
| AC-005.9 | Hay idempotencia en dos niveles: una notificación por `(evento, destinatario)` mediante `dedupe_key` único, y un job por `(entrega)`. El correo lleva un `Message-ID` determinista. La política es *at-least-once* y queda documentada |
| AC-005.10 | La UI admin de cada ticket muestra el estado de entrega por canal (entregada, pendiente o fallida) de sus notificaciones |
| AC-005.11 | *(Could)* Tiempo real por SSE. Si no se implementa, se documenta el polling como decisión |
| AC-005.12 | *(agregado el 2026-10-21)* La asignación también se envía **por correo** al nuevo responsable, con la prioridad en el asunto («Te asignaron TCK-… · Prioridad Urgente») y como píldora de color con su nivel («4 de 4»). En la app, la notificación muestra el badge de prioridad. El resto de los avisos al equipo sigue solo en la app |

## Fuera de alcance

- Push del navegador y SMS.
- Preferencias de notificación por usuario. Se documenta como mejora.
