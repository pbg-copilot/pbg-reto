# 007 · Tareas

- [x] **T007.1** Filtros rápidos y columna "Desde la última respuesta" en la bandeja
  admin (API y UI).
  Test: filtro `unattended` y orden por antigüedad. → AC-007.1
- [x] **T007.2** Acción "Tomar caso" con manejo de conflictos.
  Test Playwright: dos admins toman el mismo caso y uno ve el conflicto. → AC-007.2
- [x] **T007.3** `PATCH /support/priorities/:code` y proyección por rol en `GET`.
  Tests: 403 para no admin; el solicitante no ve objetivos. → AC-007.3, AC-007.6
- [x] **T007.4** `metrics.repository.ts` con las fórmulas.
  Tests con fixtures de fechas fijas para TPR, TR, reapertura y
  cumplimiento. → AC-007.4, AC-007.7
- [x] **T007.5** Costo de IA agregado con `pricing.ts`.
  Test: `usage` conocido da un costo esperado.
- [x] **T007.6** UI `/admin/metricas` con KPIs, tabla por prioridad y panel de
  fórmulas. → AC-007.5
- [x] **T007.7** UI `/admin/prioridades`.
- [x] **T007.8** Fórmulas en el README (sección "Métricas de atención").

## Copiloto del equipo (Should)

- [x] **T007.9** Migración `ai_usage` y el costo del copiloto en las métricas.
  → AC-007.12
- [x] **T007.10** `POST /tickets/:id/copilot/summary` y su panel con «Guardar como
  nota interna».
  Tests: incluye las notas internas; 403 para el solicitante. → AC-007.8, AC-007.13
- [x] **T007.11** `POST /tickets/:id/copilot/reply-draft` con el serializador del
  solicitante, y su integración en el compositor.
  Tests: el input al proveedor no contiene notas internas; no envía nada. → AC-007.9
- [x] **T007.12** `GET /tickets/:id/similar` y la sección «Posibles duplicados».
  Test con dos tickets parecidos. → AC-007.10
- [x] **T007.13** Pruebas de inyección en el contenido del ticket y degradación con
  `AI_FAKE_FAILURE`. → AC-007.11, AC-007.12

## Notas de implementación

- **T007.1.** La bandeja ya tenía de la 002 los filtros (responsable, antigüedad, «Sin
  atender») y la columna «Últ. respuesta». Aquí se agregó el test del filtro.
- **«Tomar caso».**
  - Solo se ofrece en tickets abiertos **sin responsable**.
  - Si otro admin lo tomó antes, avisa «Ya lo tomó X» y no lo reasigna; reasignar se hace
    desde el detalle.
  - Dos clics simultáneos chocan por la versión (409).
- **Pruebas de las fórmulas.** Usan tickets fijados en marzo de 2001, así los números
  son exactos sin depender de los datos de la demo.
- **Copiloto.**
  - Una llamada sin herramientas; el proveedor no envía `tool_choice` si no hay `tools`.
  - El borrador se arma con la vista del solicitante (rol de solicitante aunque sea
    admin), así que las notas internas no pueden entrar.
  - Los autores van como «Solicitante» o «Equipo», sin nombres.
- **Verificado con Haiku real.** «Sugerir respuesta» (test de UI) y «Resumir caso»
  (captura).
