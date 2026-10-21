# 009 · Tareas

## B · Diagnóstico

- [x] **T009.1** `get_my_account_status` con proyección mínima, sin el historial de accesos.
  Test: solo datos propios y sin campos sensibles. → AC-009.1
- [x] **T009.2** `meta.evidence` en el mensaje y la etiqueta en la UI.
  Test: la etiqueta aparece solo si se usó la herramienta. → AC-009.2
- [x] **T009.3** Reglas del prompt y del `fake` para sesión desplazada, rol y cuenta
  suspendida. → AC-009.3

## C · Acciones confirmadas

- [ ] **T009.4** Migración `assistant_actions` y las herramientas `propose_*`.
  Test: proponer no modifica el ticket. → AC-009.4
- [ ] **T009.5** Endpoints `confirm` y `cancel`: idempotencia, vencimiento, 409 si ya
  no aplica y evento con `via: assistant`.
  Tests. → AC-009.5, AC-009.6, AC-009.7
- [ ] **T009.6** `ActionCard` en el chat con sus estados.
  Test Playwright: confirmar agrega el comentario al ticket. → AC-009.5
- [ ] **T009.7** Pruebas de inyección: «confírmalo tú» no ejecuta nada. → AC-009.8

## Notas de implementación (B)

- **Proyección mínima.** El diagnóstico solo envía etiquetas: rol, estado, si pertenece
  a una agencia o es su dueño, la sesión actual y las reglas de la plataforma.
  - No lee `onboarding.login_events`: son datos reales con IP y ubicación (regla 3 de
    CLAUDE.md).
- **Orden en el prompt.** Ante problemas de acceso primero se busca en el catálogo y
  además se revisa la cuenta. Así el caso «usuario o contraseña incorrectos» (D1) sigue
  proponiendo el artículo.
- **Verificado con Haiku real.** Usó la herramienta, marcó la evidencia y explicó con
  los datos (la cuenta de test figura cancelada en la réplica); no ofreció reactivarla.
