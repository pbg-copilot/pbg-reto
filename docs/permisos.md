# Matriz de permisos

Quién puede hacer qué en el módulo de soporte, y qué test lo comprueba. Se deriva de
`specs/000-overview/domain.md` y la amplía con lo que agregaron las specs 006, 007 y
009.

## Cómo leerla

| Símbolo | Significado |
| --- | --- |
| ✔ | Permitido |
| ✖403 | El recurso se ve, pero el rol no permite la acción |
| 404 | El recurso no es visible para ese actor. Responde igual que si no existiera, para no revelar que existe |
| — | No aplica |

- **Solicitante (propio):** la persona que creó el ticket o la conversación.
- **Solicitante (ajeno):** cualquier otra persona que no es admin, **incluido el dueño
  de la agencia** del solicitante. Compartir agencia no da acceso.
- **Admin:** `onboarding.accounts.role = 'admin'`. El rol se lee de la base en cada
  request, nunca del cliente.

## Dónde se aplica

Los permisos se aplican en tres lugares, de modo que un error en uno no basta para
filtrar datos:

| Capa | Qué hace |
| --- | --- |
| `policy.ts` de cada módulo | Decide si el actor puede hacer la acción (`can_change_status`, `can_comment`…) |
| `repository.ts` | Toda consulta filtra por el actor. Un ticket ajeno no se encuentra, por eso responde 404. Las notas internas y sus adjuntos no se leen si el actor no es admin |
| Esquema de respuesta (zod) | Hay esquemas distintos para el solicitante y el admin. Lo que no está declarado no sale |

## Tickets

| Acción | Solicitante (propio) | Solicitante (ajeno) | Admin | Test |
| --- | --- | --- | --- | --- |
| Crear ticket (chat o formulario) | ✔ El solicitante sale de la sesión | — | ✔ | `tickets.test.ts` › *creates an open ticket … requester from the session*, *rejects a requester sent by the client* |
| Listar tickets | Solo los suyos | — | Todos, con filtros de bandeja | `tickets.test.ts` › *only the owner and admins can see a ticket; sharing an agency gives no access*, *AC-002.5 filters by view…*; E2E `d5-isolation` |
| Ver detalle, historial y resolución | ✔ Sin notas internas ni sus eventos | 404 | ✔ | `tickets.test.ts` › *only the owner and admins can see a ticket…*, *hides internal notes and their events from the requester*; E2E `d4-reopen`, `d5-isolation` |
| Comentario público | ✔ Abierto o En revisión. Cerrado: 409 `ticket_closed` | 404 | ✔ | `tickets.test.ts` › *returns 404 (not 403) for management actions…*, *runs the full cycle and keeps the history* |
| Corregir un comentario | ✔ Solo los propios; queda la revisión anterior | 404 | ✔ Solo los propios (✖403 sobre los de otra persona) | `tickets.test.ts` › *AC-002.11 keeps the previous text when a comment is corrected* |
| Nota interna (crear o ver) | ✖403 al crear; nunca se listan | 404 | ✔ También con el ticket cerrado | `tickets.test.ts` › *forbids internal notes and info requests from the requester*; `state-machine.test.ts` › *lets admins manage and leave internal notes on closed tickets* |
| Pedir información al solicitante | ✖403 | 404 | ✔ Salvo en su propio ticket | `tickets.test.ts` › *forbids internal notes and info requests…*, *rejects an info request on the admin's own ticket* |
| Cambiar estado | ✖403 | 404 | ✔ | `tickets.test.ts` › *runs the full cycle…*, *returns 404 (not 403)…*; `state-machine.test.ts` › *lets the owner comment and reopen but never manage* |
| Reabrir un ticket cerrado | ✔ Con motivo | 404 | ✔ | `tickets.test.ts` › *runs the full cycle…*; E2E `d4-reopen` |
| Asignar responsable, prioridad, categoría, etiquetas | ✖403 | 404 | ✔ | `tickets.test.ts` › *assigns only admins and records internal events hidden from the requester* |
| Ver la lista de admins asignables (`GET /support/admins`) | ✖403 | — | ✔ | `tickets.test.ts` › *lists categories and hides priority targets from requesters* |
| Cambios concurrentes (`version`) | — | — | El primero gana; el otro recibe 409 con el ticket actual | `tickets.test.ts` › *lets one admin win and returns 409…*; E2E `d6-resilience` (D6c) |

## Adjuntos

| Acción | Solicitante (propio) | Solicitante (ajeno) | Admin | Test |
| --- | --- | --- | --- | --- |
| Subir a un ticket | ✔ Siempre público. Ticket cerrado: 409 | 404 | ✔ Público o interno, también con el ticket cerrado | `attachments.test.ts` › *the owner uploads public evidence…*, *D5: another requester cannot upload…*, *a closed ticket rejects public evidence (409)…* |
| Subir como interno o en una nota interna | ✖403 | 404 | ✔ Hereda la visibilidad de la nota | `attachments.test.ts` › *a requester cannot upload internal files nor attach to an internal note* |
| Descargar un adjunto público | ✔ | 404 | ✔ | `attachments.test.ts` › *serves the file by streaming with safe headers…*; E2E `d5-isolation` |
| Descargar un adjunto interno | 404 | 404 | ✔ | `attachments.test.ts` › *an attachment on an internal note inherits internal and is invisible to the requester*; E2E `d4-reopen` |
| Retirar un adjunto | ✖403 | 404 | ✔ Con motivo; queda trazabilidad | `attachments.test.ts` › *only admins remove; the file stops being served and the trace stays* |
| Adjuntar en el chat | ✔ Solo en su conversación | 404 | ✔ Solo en las suyas | `attachments.test.ts` › *rejects attachments from another conversation or another person* |
| Compartir una imagen con el asistente (visión) | ✔ Con consentimiento explícito | — | ✔ Igual | `attachments.test.ts` › *without consent the model only receives the file metadata…*, *with consent the image goes to the model…* |

## Asistente y conversaciones

| Acción | Solicitante (propio) | Solicitante (ajeno) | Admin | Test |
| --- | --- | --- | --- | --- |
| Crear y continuar su conversación | ✔ | 404 | ✔ Solo las suyas | `assistant.test.ts` › *another user's conversation is invisible and injection grants nothing* |
| Ver la conversación de origen de un ticket | ✔ | 404 | ✔ Solo lectura | `assistant.test.ts` › *lets an admin read (only read) the conversation behind a ticket* |
| Consultar sus tickets desde el chat (`get_my_tickets`) | ✔ Solo los suyos | Nunca devuelve ajenos | ✔ Solo los suyos | `assistant.test.ts` › *AC-004.12 only keeps ticket numbers the actor can see*; E2E `d5-isolation` (inyección) |
| Diagnóstico de cuenta (`get_my_account_status`) | ✔ Solo la propia, con proyección mínima | — | ✔ Solo la propia | `assistant.test.ts` › *reads only the own account with a minimal projection…* |
| Proponer un comentario o una reapertura | El asistente propone; nada cambia hasta confirmar | Nunca sobre tickets ajenos | Igual | `assistant-actions.test.ts` › *proposing changes nothing…*, *does not propose actions on a ticket of another person* |
| Confirmar o cancelar una propuesta | ✔ Solo la persona dueña, con un clic | 404 | Solo las de sus conversaciones | `assistant-actions.test.ts` › *another person cannot confirm, and 'confirm it yourself' changes nothing* |
| Elegir el solicitante, cambiar estados o cerrar | El modelo **nunca** puede: no hay herramienta para eso | — | — | `assistant.test.ts` › *rejects extra fields (the model cannot choose the requester) and unknown tools* |

## Catálogo e incidentes

| Acción | Solicitante | Admin | Test |
| --- | --- | --- | --- |
| Buscar y leer artículos publicados | ✔ | ✔ | `articles.test.ts` › *finds seeded examples without accents, with typos and by category* |
| Ver borradores y archivados | ✖ No aparecen (404) | ✔ | `articles.test.ts` › *hides drafts and archived articles from requesters, not from admins* |
| Crear, versionar, publicar, archivar o descartar artículos | ✖403 | ✔ | `articles.test.ts` › *keeps versions immutable…*, *never discards an article that was published (409)…* |
| Borrador desde un ticket resuelto | ✖403 | ✔ Sin notas internas y con datos personales enmascarados | `articles.test.ts` › *copies only whitelisted, redacted fields and never internal notes* |
| Ver incidentes | ✔ Solo campos públicos | ✔ | `articles.test.ts` › *exposes only public fields and links tickets with a public event* |
| Gestionar incidentes | ✖403 | ✔ | Ídem |

## Notificaciones

| Acción | Solicitante (propio) | Otra persona | Admin | Test |
| --- | --- | --- | --- | --- |
| Listar, contar y marcar leídas | Solo las suyas | 404 | Solo las suyas | `notifications.test.ts` › *persists while offline, lists only own notifications, and marks them read*, *requires a session* |
| Recibir avisos de notas internas | Nunca | — | — | `notifications.test.ts` › *internal notes never reach the requester…*; `notifications-plan.test.ts` › *AC-005.3 internal notes notify nobody*; E2E `d3-admin-flow` |
| Ver entregas por canal (`GET /tickets/:id/deliveries`) | ✖403 | ✖403 | ✔ Sin direcciones de correo | `notifications.test.ts` › *admins see the delivery status per channel without email addresses; requesters get 403* |
| Reintentar un correo fallido | ✖403 | ✖403 | ✔ Solo si está `failed` (si no, 409) | `notifications.test.ts` › *an admin can retry a failed email; anything else is a 409* |

## Métricas, prioridades y copiloto

| Acción | Solicitante | Admin | Test |
| --- | --- | --- | --- |
| Métricas de atención (`GET /support/metrics`) | ✖403 | ✔ | `metrics.test.ts` › *is admin-only and validates the range* |
| Estado operativo en vivo (`GET /support/metrics/operations`) | ✖403 | ✔ | `metrics.test.ts` › *live operations: what needs attention now, oldest first* |
| Exportar el rango a Excel (`GET /support/metrics/export`) | ✖403 | ✔ Sin datos del solicitante ni notas internas | `metrics.test.ts` › *AC-007.20 exports the range to a real .xlsx without requester data; requesters get 403* |
| Configurar objetivos de prioridad | ✖403 | ✔ | `metrics.test.ts` › *only admins configure targets and requesters never see them* |
| Ver objetivos y plazos de prioridad | Nunca se envían | ✔ | Ídem, y `tickets.test.ts` › *lists categories and hides priority targets from requesters* |
| Copiloto: resumir caso o sugerir respuesta | ✖403 | ✔ La respuesta sugerida nunca usa notas internas | `metrics.test.ts` › *is admin-only*, *the reply draft never includes internal notes, even if the ticket asks for them* |
| Posibles duplicados (`GET /tickets/:id/similar`) | ✖403 | ✔ | `metrics.test.ts` › *is admin-only*, *AC-007.10 lists similar open tickets…* |

## Reglas transversales

| Regla | Test |
| --- | --- |
| Sin sesión, todo endpoint protegido responde 401 | `app.test.ts` › *returns 401 without a session* |
| Una ruta de admin responde 403 a quien no es admin | `app.test.ts` › *returns 403 for a non-admin on an admin route and 200 for an admin* |
| Un `Origin` fuera de `APP_ORIGIN` responde 403 | `app.test.ts` › *rejects an untrusted origin*; `tests/api.test.mjs` (repo base) |
| Las claves de idempotencia son por cuenta | `idempotency.test.ts` › *scopes keys per account and requires the header* |

Los tests de integración están en `backend/test/` y corren con `pnpm test:unit`. Los
E2E están en `tests/e2e/` y corren con `pnpm test:e2e`. Los tests de integración usan
tres actores: el dueño (`agente048`), otro usuario (`agente002`, y `agente049` como
dueño de agencia) y un admin (`agente015`).
