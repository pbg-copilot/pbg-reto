# 005 · Tareas

- [ ] **T005.1** Migración `0005_notifications`.
  Test: idempotente; `dedupe_key` y `(notification_id, channel)` únicos.
- [ ] **T005.2** Esquemas zod compartidos (`notifications.ts`) y textos en español
  por tipo, en una función pura `renderNotification(event)`.
  Test unitario: un `status_changed` produce "TCK-000042 pasó de Abierto a En
  revisión".
- [ ] **T005.3** `listener.ts` con `resolveRecipients` registrado en `recordEvent`.
  Tests: tabla de destinatarios; nada para el solicitante en eventos internos;
  el actor queda excluido. → AC-005.1, AC-005.2, AC-005.3
- [ ] **T005.4** Atomicidad.
  Test: forzar un error después de `recordEvent` deja 0 notificaciones y el ticket
  sin cambios. → AC-005.1
- [ ] **T005.5** Endpoints de la bandeja.
  Tests: solo propias; ajena → 404; `read` idempotente; `read-all`. → AC-005.5
- [ ] **T005.6** Handler `deliver_email` con nodemailer + Mailpit.
  Tests con transporte mockeado: reintentos, `failed` final, idempotencia si ya
  está `delivered`. → AC-005.7, AC-005.8, AC-005.9
- [ ] **T005.7** Deliveries en el detalle admin y botón "Reintentar entrega"
  (*Should*). → AC-005.10
- [ ] **T005.8** UI: campana con polling, popover, página `/notificaciones` y
  navegación con 404 amable. → AC-005.4, AC-005.6
- [ ] **T005.9** E2E de offline (D3) y de Mailpit detenido (D6), en 008.
- [ ] **T005.10** Documentar en el README la política at-least-once, el polling y la
  forma de ver los correos en `http://localhost:8025`. → AC-005.11
