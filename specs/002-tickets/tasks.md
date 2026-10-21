# 002 · Tareas

## Datos

- [x] **T002.1** Migración `0002_tickets` + seeds de categorías y prioridades.
  Test: idempotente; las tablas y la secuencia existen.
- [x] **T002.2** Esquemas zod compartidos en `packages/shared/src/tickets.ts`.
  Test: typecheck en back y front.

## Dominio

- [x] **T002.3** `state-machine.ts` (puro).
  Tests unitarios de cada transición válida e inválida, mismo estado y motivos
  requeridos. → AC-002.12, AC-002.13
- [x] **T002.4** `policy.ts`.
  Tests unitarios por rol y acción según la matriz de permisos.
- [x] **T002.5** `events.ts` con `recordEvent` y registro de listeners.
  Test: el evento y el listener corren en la misma transacción, y un rollback del
  listener revierte todo. → AC-002.16, AC-002.17

## API

- [x] **T002.6** Repositorio con scoping por actor y serializers por rol.
  Test: el solicitante nunca recibe campos internos (snapshot del esquema de
  respuesta). → AC-002.10
- [x] **T002.7** `POST /tickets` con idempotencia, prioridad inicial según impacto,
  evento `created` y número visible.
  Tests: 201; un reintento devuelve el mismo `id`; el solicitante sale de la
  sesión. → AC-002.1, AC-002.2, AC-002.3
- [x] **T002.8** `GET /tickets` con vistas, filtros, búsqueda, orden, paginación y
  `unread`.
  Tests: aislamiento entre `agente048`, `agente049` y `agente002`; el admin ve todo;
  cada filtro; las notas internas no generan `unread` para el
  solicitante. → AC-002.4, AC-002.5, AC-002.6
- [x] **T002.9** `GET /tickets/:id`: detalle filtrado y lectura marcada.
  Tests: ajeno → 404; el detalle del solicitante no tiene notas internas ni eventos
  internos. → AC-002.7, AC-002.10
- [x] **T002.10** `POST /tickets/:id/comments` con `first_response_at`,
  `last_*_reply_at` y `requests_info`.
  Tests: un solicitante con nota interna → 403; ticket cerrado → 409; la primera
  respuesta del admin fija `first_response_at`. → AC-002.8, AC-002.9
- [x] **T002.11** `PATCH /tickets/:id/status`.
  Tests: transiciones, 422 en sus dos variantes, mismo estado sin evento, 409 por
  versión con dos admins. → AC-002.12, AC-002.14
- [x] **T002.12** `POST /tickets/:id/reopen`.
  Tests: el dueño reabre, se conserva el historial, `reopened_count` sube, un
  ticket ajeno → 404. → AC-002.13
- [x] **T002.13** `PATCH /tickets/:id/assignee` y `PATCH /tickets/:id`, más
  `GET /support/admins`, `GET /support/categories` y `GET /support/priorities`.
  Tests: asignar a un no admin → 400; eventos internos; 409 por
  versión. → AC-002.15
- [x] **T002.14** *(Should)* Editar comentario con revisiones.
  Test: la revisión queda guardada y hay evento `comment_edited`. → AC-002.11

## UI

- [x] **T002.15** Lista "Mis tickets" / bandeja: pestañas, filtros en la URL,
  paginación, no leídos y actualizaciones recientes. → AC-002.18, AC-002.21
- [x] **T002.16** Detalle: reporte original y resumen IA, pasos intentados, hilo,
  historial y resolución. → AC-002.19
- [x] **T002.17** Acciones del admin: estado con diálogo de motivo, asignar,
  atributos, nota interna, y UI de conflicto 409 que conserva el texto.
  Test Playwright: dos contextos de admin, uno ve el conflicto. → AC-002.14
- [x] **T002.18** Acciones del solicitante: responder y reabrir.
- [x] **T002.19** Formulario manual `/tickets/nuevo` con `Idempotency-Key` estable
  durante los reintentos.
  Test Playwright: doble click o reintento → un solo ticket. → AC-002.20
- [x] **T002.20** Documentar los endpoints en OpenAPI (automático con zod) y revisar
  `/docs`.

## Notas de implementación (2026-10-20)

Precisiones de reglas (ya reflejadas en `000-overview`):
- **Cierre como duplicado:** se envía `duplicate_of_number` (el número visible) y el
  servidor guarda `duplicate_of_ticket_id`.
- **Abierto → Cerrado** admite cualquier motivo, siempre con su resumen o su ticket
  original.
- **Notas internas en tickets cerrados:** un admin puede dejarlas; los comentarios
  públicos exigen reabrir (409 `ticket_closed`).
- **Mismo estado:** un `PATCH` con el estado actual responde 200 sin evento, aunque la
  `version` esté desactualizada, para que un doble clic no se convierta en un conflicto.
- **Activación de filtros:** `assignee`, `requester`, `age` y `unattended` solo
  aplican al admin; para un solicitante se ignoran.
- **Contadores:** `counts` (pestañas) aplica todos los filtros salvo `view`.

Implementación:
- **Rate limit:** las mutaciones se agrupan por sesión, porque el límite corre antes
  de la autenticación.
- **Frontend:**
  - rutas con carga diferida (`lazy`) por pantalla;
  - filtros en la URL;
  - el conflicto 409 conserva lo escrito y permite reaplicarlo sobre la versión
    nueva;
  - el `Alert` de sugerencias usa `role="note"`.
- **Tests de UI:** un login por cuenta y por archivo, porque el login del repo base
  limita a 15 por minuto y por IP.

**Verificación:**
- `pnpm test:unit`: 46/46 (22 nuevos de tickets).
- `pnpm test:ui`: 9/9 (4 nuevos).
- `pnpm test` (repo base): 6/6.
- Typecheck y lint: OK.
- Los tests borran sus tickets al terminar.
