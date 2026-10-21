# Pendientes, problemas conocidos y mejoras

Este archivo junta en un solo lugar lo que falta, lo que se dejó fuera y los problemas
conocidos. El detalle de cada feature está en su carpeta. Actualizado el 2026-10-21.

| Qué | Dónde se registra |
| --- | --- |
| Criterios y tareas de cada feature | `specs/NNN-*/spec.md` y `tasks.md` (checkboxes) |
| Desvíos y decisiones al implementar | Sección «Notas de implementación» de cada `tasks.md` |
| Decisiones técnicas | `docs/adr/` (0001–0005) |
| Qué cambió y por qué | Mensajes de commit (Conventional Commits) |
| Pendientes y problemas conocidos | Este archivo |

## Falta para entregar (spec 008, Must)

- [ ] **E2E deterministas de D1 a D6.**
  - Hoy los tests de UI corren contra Haiku real, que no siempre responde igual (el D1
    falló una vez).
  - La propuesta es correr el stack de tests con `AI_PROVIDER=fake` y dejar el modelo real
    para la demo y las pruebas manuales.
- [ ] **Guion de demo en el README:** los 6 casos, paso a paso, con las cuentas.
- [ ] **`docs/permisos.md`:** la matriz de permisos con el test que cubre cada fila.
- [ ] **`docs/api.md`:** el resumen de endpoints (el detalle está en `/docs`, OpenAPI).
- [ ] **Clon limpio:** `docker compose up` y todos los tests en verde desde cero.
- [ ] **Revisión final de secretos y datos personales** en todo el historial de la rama.
- [ ] **Estado final de las specs** y el texto del PR (sin crearlo hasta que se pida).

## Fuera de alcance o pendiente (Should / Could)

| Tema | Estado | Referencia |
| --- | --- | --- |
| `pnpm eval:assistant` (10 escenarios con su costo) | Pendiente (Should) | T004.19 |
| Tiempo real por SSE | No se implementa: polling cada 20 s, documentado | AC-005.11 |
| Preferencias de notificación por usuario | Fuera de alcance | 005 |
| Proveedor de correo real (SES o Resend) | Fuera de alcance: Mailpit en el reto | 005 |
| Antivirus para adjuntos (ClamAV) | Documentado como siguiente paso | 006 |
| Purga de binarios retirados y de huérfanos en S3 | Documentado, sin job | 006 |
| Paginar comentarios en hilos muy largos | Pendiente; hoy se cargan todos | 002 |
| MCP (backend como cliente y servidor de solo lectura para el equipo) | Diferido | ADR 0005 |
| Embeddings (`pgvector`) | Opcional si el catálogo crece | ADR 0005 |
| Fusionar tickets duplicados | Fuera de alcance (solo se muestran) | 007 |
| Horario laboral y feriados en las métricas | Fuera de alcance | 007 |

## Problemas conocidos

| Problema | Impacto | Cómo se maneja |
| --- | --- | --- |
| La cuenta de test `agente048` figura **cancelada** en la réplica | El diagnóstico de cuenta responde «cancelada» | Los tests que necesitan una cuenta activa usan `agente002` |
| `pnpm test` (repo base) inicia y cierra sesión con las cuentas de demo | Te saca de la sesión si estás probando | Correrlo cuando no estés usando `agente099`, `agente009` o `agente016` |
| Límite de 15 logins por minuto | Correr la UI varias veces seguidas falla en el login | Esperar un minuto entre corridas |
| Correo *at-least-once* | Si el worker muere justo después de enviar, el correo se repite | Mismo `Message-ID`: los clientes lo agrupan (README) |
| Confirmar una acción del asistente (009) | Si el proceso muere entre ejecutar y marcar confirmada, un reintento podría repetirla | Ventana muy corta, documentada en `specs/009/tasks.md` |
| `minimumReleaseAge` de pnpm (1 día) | No deja instalar versiones publicadas hoy | Es intencional (cadena de suministro): se elige una versión anterior |
| Cambios del prompt o de las herramientas | Haiku 5.5 rechaza el *thinking* de conversaciones anteriores | El proveedor reintenta una vez sin los bloques *thinking* (ADR 0005, spec 006) |
