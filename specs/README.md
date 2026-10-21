# Specs · Soporte y tickets con IA

Specs del reto en formato Spec-Driven Development. El alcance lo define
`docs/Reto_Soporte_Tickets_IA_PBG.pdf`. Las reglas de trabajo están en `CLAUDE.md`.

## Cómo se usa

1. Leer primero `000-overview/`: principios, dominio y convenciones de API. Aplica
   a todas las features.
2. Cada feature tiene tres archivos:
   - `spec.md`: qué y por qué (historias y criterios de aceptación).
   - `plan.md`: cómo (datos, endpoints, diseño, riesgos).
   - `tasks.md`: pasos pequeños, cada uno con su test.
3. Una spec pasa de **Borrador** a **Aprobada** cuando el usuario la revisa. Sin
   spec aprobada no se escribe código de esa feature.
4. Una tarea se marca `[x]` solo cuando su test pasa. Si la implementación obliga a
   cambiar el alcance, primero se actualiza la spec.

## Estado y calendario

| # | Feature | Estado | Prioridad | Objetivo |
| --- | --- | --- | --- | --- |
| 000 | [overview](000-overview/) | Aprobada (referencia) | — | — |
| 001 | [foundation](001-foundation/) | **Hecha** | Must | 20 oct, noche |
| 002 | [tickets](002-tickets/) | **Hecha** | Must | 21 oct, mañana |
| 003 | [catalog](003-catalog/) | **Hecha** | Must | 21 oct, tarde |
| 004 | [assistant](004-assistant/) | **Hecha** | Must | 21 oct, tarde |
| 005 | [notifications](005-notifications/) | **Hecha** | Must | 21 oct, noche |
| 006 | [attachments](006-attachments/) | **Hecha** (+ visión) | Must · visión Should | 21 oct, noche |
| 009 | [assistant-skills](009-assistant-skills/) | **Hecha** | Should | 21 oct, noche |
| 007 | [admin-metrics](007-admin-metrics/) | **Hecha** (+ copiloto) | Should | 21 oct, noche |
| 008 | [delivery](008-delivery/) | **Hecha** (falta correr `pnpm test` del repo base) | Must | 22 oct, tarde |

Orden de implementación desde aquí, acordado el 2026-10-21:

1. **005** · notificaciones.
2. **006** · adjuntos, con la visión con consentimiento (A) y el diagnóstico de la
   cuenta de la 009 (B).
3. **009** · acciones confirmadas (C).
4. **007** · métricas, con el copiloto del equipo (D).
5. **008** · entrega.

Las decisiones de MCP, Agent Skills y embeddings (E, F, G) están en
`docs/adr/0005-ai-capabilities-roadmap.md`.

El orden sigue las dependencias:
- El asistente (004) necesita tickets (002) y catálogo (003).
- Las notificaciones (005) se conectan al registro de eventos de 002.
- Los adjuntos (006) se integran en tickets y chat ya existentes.
- Las acciones confirmadas (009) reutilizan el servicio de tickets de 002 y el chat de 004.

## Fuera de alcance / futuro

Todas las specs están hechas. Lo que quedó fuera o pendiente:
- `pnpm eval:assistant` (T004.19, Should);
- tiempo real por SSE (hoy hay polling cada 20 s);
- proveedor de correo real, antivirus y purga de adjuntos;
- MCP y embeddings (ADR 0005);
- fusionar duplicados y horario laboral en las métricas.

El detalle, junto con los problemas conocidos, está en [`BACKLOG.md`](BACKLOG.md).

## Identificadores

- Criterio de aceptación: `AC-<feature>.<n>`, por ejemplo `AC-002.4`. El nombre de
  cada test incluye el ID que cubre.
- Tarea: `T<feature>.<n>`, por ejemplo `T002.7`.
- Sección del PDF: `§NN`, por ejemplo `§05`.
- Caso mínimo de demostración del §14: `D1`–`D6`.

## Casos mínimos de demostración (§14)

| ID | Caso | Specs | Test E2E |
| --- | --- | --- | --- |
| D1 | Consulta conocida resuelta con artículo y confirmación del usuario, sin ticket innecesario | 003, 004 | `tests/e2e/d1-known-issue.spec.ts` |
| D2 | Problema desconocido o persistente → ticket Abierto con contexto y enlace; un reintento no lo duplica | 002, 004 | `tests/e2e/d2-escalation.spec.ts` |
| D3 | El admin revisa, comenta, adjunta y cierra; cada transición notifica al solicitante, también si estaba desconectado | 002, 005, 006 | `tests/e2e/d3-admin-flow.spec.ts` |
| D4 | El usuario responde y reabre; se conserva el historial; las notas internas y sus adjuntos siguen ocultos | 002, 006 | `tests/e2e/d4-reopen.spec.ts` |
| D5 | Se rechaza el acceso a tickets y adjuntos ajenos; instrucciones maliciosas no amplían permisos | 002, 004, 006 | `tests/e2e/d5-isolation.spec.ts` + integración |
| D6 | Caída del modelo, fallo de entrega y cambios concurrentes se recuperan; el soporte sigue sin IA | 002, 004, 005 | `tests/e2e/d6-resilience.spec.ts` |

## Trazabilidad PDF → specs

| § | Tema | Spec |
| --- | --- | --- |
| 01 | Chat como entrada al soporte | 004 |
| 02 | Cuándo crear un ticket | 004, 002 |
| 03 | Catálogo de problemas conocidos | 003 |
| 04 | Información y sección de tickets | 002 |
| 05 | Estados y reglas de transición | 002 |
| 06 | Experiencia del solicitante | 002, 005, 006 |
| 07 | Gestión administrativa | 002, 007 |
| 08 | Notificaciones | 005 |
| 09 | Archivos e historial | 006, 002 |
| 10 | Base técnica | 001 |
| 11 | Modelo de IA y herramientas | 004, 009, 006 (visión), 007 (copiloto) |
| 12 | Endpoints propuestos | 000/api-conventions y cada feature |
| 13 | Repositorio e instalación | 001, 008 |
| 14 | Casos mínimos de demostración | 008 |
| 15 | Entregables y evaluación | 008 |

## Recorte si falta tiempo

Se recorta en este orden. Los casos D1–D6 no se tocan.

1. Tiempo real por SSE (queda el polling).
2. Vista previa de imágenes dentro de la UI (queda la descarga).
3. Edición de comentarios con revisiones (queda solo la creación).
4. Prellenado con IA del artículo creado desde un ticket (queda el prellenado sin IA).
5. Copiloto del equipo: primero «Resumir caso» y luego «Sugerir respuesta» (quedan
   los duplicados, que no usan IA).
6. Visión con consentimiento (quedan los metadatos del adjunto).
7. Acciones confirmadas de la 009 (queda el diagnóstico de cuenta).
8. Métricas por prioridad contra objetivos (quedan los tiempos globales).

## Cuentas

| Uso | Cuentas |
| --- | --- |
| Demo manual (no usar en tests) | `agente099` solicitante, `agente009` admin, `agente016` dueño de agencia |
| Tests automáticos | `agente048` solicitante, `agente049` dueño de su misma agencia, `agente002` otro solicitante, `agente015` y `agente104` admins |

Hay una sola sesión activa por cuenta. Separar las cuentas evita que los tests
cierren la sesión de la demo.
