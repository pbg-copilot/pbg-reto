# 007 · Tareas

- [ ] **T007.1** Filtros rápidos y columna "Desde la última respuesta" en la bandeja
  admin (API y UI).
  Test: filtro `unattended` y orden por antigüedad. → AC-007.1
- [ ] **T007.2** Acción "Tomar caso" con manejo de conflictos.
  Test Playwright: dos admins toman el mismo caso y uno ve el conflicto. → AC-007.2
- [ ] **T007.3** `PATCH /support/priorities/:code` y proyección por rol en `GET`.
  Tests: 403 para no admin; el solicitante no ve objetivos. → AC-007.3, AC-007.6
- [ ] **T007.4** `metrics.repository.ts` con las fórmulas.
  Tests con fixtures de fechas fijas para TPR, TR, reapertura y
  cumplimiento. → AC-007.4, AC-007.7
- [ ] **T007.5** Costo de IA agregado con `pricing.ts`.
  Test: `usage` conocido da un costo esperado.
- [ ] **T007.6** UI `/admin/metricas` con KPIs, tabla por prioridad y panel de
  fórmulas. → AC-007.5
- [ ] **T007.7** UI `/admin/prioridades`.
- [ ] **T007.8** Fórmulas en el README (sección "Métricas de atención").
