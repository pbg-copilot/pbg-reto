# 002 · Tareas

## Datos

- [ ] **T002.1** Migración `0002_tickets` + seeds de categorías y prioridades.
  Test: idempotente; las tablas y la secuencia existen.
- [ ] **T002.2** Esquemas zod compartidos en `packages/shared/src/tickets.ts`.
  Test: typecheck en back y front.

## Dominio

- [ ] **T002.3** `state-machine.ts` (puro).
  Tests unitarios de cada transición válida e inválida, mismo estado y motivos
  requeridos. → AC-002.12, AC-002.13
- [ ] **T002.4** `policy.ts`.
  Tests unitarios por rol y acción según la matriz de permisos.
- [ ] **T002.5** `events.ts` con `recordEvent` y registro de listeners.
  Test: el evento y el listener corren en la misma transacción, y un rollback del
  listener revierte todo. → AC-002.16, AC-002.17

## API

- [ ] **T002.6** Repositorio con scoping por actor y serializers por rol.
  Test: el solicitante nunca recibe campos internos (snapshot del esquema de
  respuesta). → AC-002.10
- [ ] **T002.7** `POST /tickets` con idempotencia, prioridad inicial según impacto,
  evento `created` y número visible.
  Tests: 201; un reintento devuelve el mismo `id`; el solicitante sale de la
  sesión. → AC-002.1, AC-002.2, AC-002.3
- [ ] **T002.8** `GET /tickets` con vistas, filtros, búsqueda, orden, paginación y
  `unread`.
  Tests: aislamiento entre `agente048`, `agente049` y `agente002`; el admin ve todo;
  cada filtro; las notas internas no generan `unread` para el
  solicitante. → AC-002.4, AC-002.5, AC-002.6
- [ ] **T002.9** `GET /tickets/:id`: detalle filtrado y lectura marcada.
  Tests: ajeno → 404; el detalle del solicitante no tiene notas internas ni eventos
  internos. → AC-002.7, AC-002.10
- [ ] **T002.10** `POST /tickets/:id/comments` con `first_response_at`,
  `last_*_reply_at` y `requests_info`.
  Tests: un solicitante con nota interna → 403; ticket cerrado → 409; la primera
  respuesta del admin fija `first_response_at`. → AC-002.8, AC-002.9
- [ ] **T002.11** `PATCH /tickets/:id/status`.
  Tests: transiciones, 422 en sus dos variantes, mismo estado sin evento, 409 por
  versión con dos admins. → AC-002.12, AC-002.14
- [ ] **T002.12** `POST /tickets/:id/reopen`.
  Tests: el dueño reabre, se conserva el historial, `reopened_count` sube, un
  ticket ajeno → 404. → AC-002.13
- [ ] **T002.13** `PATCH /tickets/:id/assignee` y `PATCH /tickets/:id`, más
  `GET /support/admins`, `GET /support/categories` y `GET /support/priorities`.
  Tests: asignar a un no admin → 400; eventos internos; 409 por
  versión. → AC-002.15
- [ ] **T002.14** *(Should)* Editar comentario con revisiones.
  Test: la revisión queda guardada y hay evento `comment_edited`. → AC-002.11

## UI

- [ ] **T002.15** Lista "Mis tickets" / bandeja: pestañas, filtros en la URL,
  paginación, no leídos y actualizaciones recientes. → AC-002.18, AC-002.21
- [ ] **T002.16** Detalle: reporte original y resumen IA, pasos intentados, hilo,
  historial y resolución. → AC-002.19
- [ ] **T002.17** Acciones del admin: estado con diálogo de motivo, asignar,
  atributos, nota interna, y UI de conflicto 409 que conserva el texto.
  Test Playwright: dos contextos de admin, uno ve el conflicto. → AC-002.14
- [ ] **T002.18** Acciones del solicitante: responder y reabrir.
- [ ] **T002.19** Formulario manual `/tickets/nuevo` con `Idempotency-Key` estable
  durante los reintentos.
  Test Playwright: doble click o reintento → un solo ticket. → AC-002.20
- [ ] **T002.20** Documentar los endpoints en OpenAPI (automático con zod) y revisar
  `/docs`.
