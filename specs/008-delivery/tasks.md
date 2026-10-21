# 008 · Tareas

## E2E

- [ ] **T008.1** Configuración E2E de Playwright, setup de `storageState` y helpers
  de API, Mailpit y compose.
- [ ] **T008.2** `d1-known-issue.spec.ts`. → AC-008.2
- [ ] **T008.3** `d2-escalation.spec.ts`: sin artículo + reintento sin duplicado +
  variante de dos fallos. → AC-008.2
- [ ] **T008.4** `d3-admin-flow.spec.ts`: solicitante desconectado, admin con todo el
  ciclo, notificaciones y correos en Mailpit. → AC-008.2
- [ ] **T008.5** `d4-reopen.spec.ts`: reabrir, historial, aislamiento de notas
  internas y sus adjuntos. → AC-008.2
- [ ] **T008.6** `d5-isolation.spec.ts`: URLs ajenas → 404 en UI y API, más inyección
  en el chat. → AC-008.2
- [ ] **T008.7** `d6-resilience.spec.ts`: IA caída con formulario, Mailpit detenido
  y recuperado, conflicto de dos admins. → AC-008.2

## Documentación

- [ ] **T008.8** README completo con el guion de demo. → AC-008.4
- [ ] **T008.9** `docs/api.md` y `docs/permisos.md` con referencias a tests. → AC-008.5
- [ ] **T008.10** Completar el ADR 0003 con el costo real medido.

## Verificación final

- [ ] **T008.11** Clon limpio, arranque y todos los tests en verde. → AC-008.1, AC-008.3
- [ ] **T008.12** Revisión de secretos y datos personales:
  `git grep -nE 'sk-ant-|AKIA|ghp_|BEGIN (RSA|OPENSSH)'`, y revisar que los seeds
  solo tengan datos ficticios. → AC-008.6
- [ ] **T008.13** Actualizar el estado de todas las specs. → AC-008.8
- [ ] **T008.14** Redactar la descripción del PR, **sin crearlo** hasta que el
  usuario lo pida. → AC-008.7
