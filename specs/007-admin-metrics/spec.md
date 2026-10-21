# 007 · Gestión administrativa y métricas

- **Estado:** Hecha (2026-10-21)
- **Prioridad:** Should (la bandeja y los filtros básicos ya son Must en 002)
- **PDF:** §07
- **Depende de:** 002, 003, 004 (costos de IA)

## Problema

El equipo necesita priorizar: ver qué está sin atender, cuánto tarda en responder y
en resolver, y configurar prioridades. Todo sin prometer plazos que no se
establecieron.

## Fórmulas (documentadas también en el README)

Todo se mide en tiempo calendario (no hay horario laboral en el reto), en UTC, sobre
los tickets creados en el rango `[from, to)`.

| Métrica | Fórmula | Reaperturas |
| --- | --- | --- |
| **Tiempo de primera respuesta (TPR)** | `first_response_at − created_at`, donde `first_response_at` es el primer **comentario público** de un admin. Las notas internas, los cambios de estado y la asignación **no cuentan** como respuesta | No se recalcula al reabrir |
| **Tiempo de resolución (TR)** | `closed_at − created_at`, solo para tickets `closed` con `closure_reason = resolved` | Se mide hasta el **último** cierre, así que la reapertura alarga el TR. Además se informa la **tasa de reapertura** = tickets con `reopened_count > 0` / tickets resueltos |
| **Sin atender** | `status = 'open'` y `first_response_at IS NULL` | Un ticket reabierto con primera respuesta previa no cuenta como sin atender, pero aparece en la lista "Reabiertos" |
| **Tiempo desde la última respuesta** | `now − coalesce(last_team_reply_at, created_at)` para los tickets no cerrados | — |
| **Cumplimiento de objetivo** | Solo si la prioridad tiene objetivo configurado: % de tickets con TPR (o TR) ≤ objetivo. Sin objetivo se muestra "Sin objetivo definido" | Igual que TPR y TR |
| **Costo de IA** | Σ `usage` de los mensajes del asistente × precios de `pricing.ts`. Se muestran el total y el promedio por conversación | — |

Las métricas se muestran como **mediana y p90**, que son robustas ante valores
extremos, y también el promedio.

## Criterios de aceptación

| ID | Criterio |
| --- | --- |
| AC-007.1 | La bandeja admin permite filtrar por estado, prioridad, categoría, responsable (`me`, `unassigned`, un admin) y antigüedad, más el filtro rápido "Sin atender" y la columna "Desde la última respuesta" |
| AC-007.2 | Las acciones rápidas en la bandeja (tomar el caso: asignarme y pasar a En revisión) respetan `version` y los conflictos de 002 |
| AC-007.3 | `GET /support/priorities` lista las prioridades. `PATCH /support/priorities/:code` (admin) configura nombre, orden y los objetivos opcionales de primera respuesta y resolución en minutos. Cambiar un objetivo no reescribe los tickets anteriores |
| AC-007.4 | `GET /support/metrics?from&to` (admin) devuelve: conteos por estado, sin atender, reabiertos, TPR y TR (mediana, p90, promedio), tasa de reapertura, cumplimiento por prioridad (solo si hay objetivo), tickets por categoría y costo de IA. Un no admin recibe 403 |
| AC-007.5 | `/admin/metricas` muestra las tarjetas de KPIs, una tabla por prioridad y las fórmulas visibles en un panel "¿Cómo se calcula?" |
| AC-007.6 | Ninguna vista del solicitante muestra objetivos, vencimientos ni plazos |
| AC-007.7 | Las fórmulas se prueban con tickets fijados en el tiempo (fixtures con `created_at` y `closed_at` controlados) |

## Copiloto del equipo · *Should*

Decidido el 2026-10-21 (ver `docs/adr/0005-ai-capabilities-roadmap.md`). La IA ayuda
al admin, pero **no decide ni envía nada**.

| ID | Criterio |
| --- | --- |
| AC-007.8 | **Resumir caso.** En el detalle del ticket, el admin pulsa «Resumir caso» y recibe un resumen de 3 a 6 viñetas: problema, pasos ya intentados, último estado y qué falta. Usa la descripción, los comentarios públicos, las notas internas y el contexto del chat. Se muestra en un panel marcado «Borrador de IA · interno» y el admin puede guardarlo como nota interna |
| AC-007.9 | **Sugerir respuesta.** «Sugerir respuesta» llena el compositor con un borrador **público** que el admin edita y envía con el botón normal. El borrador se genera **sin** notas internas ni adjuntos internos (no puede filtrarlos) y cita artículos publicados del catálogo cuando aplican. Nunca se envía solo |
| AC-007.10 | **Posibles duplicados.** El detalle admin muestra hasta 5 tickets no cerrados de los últimos 30 días con título o descripción parecidos (pg_trgm, sin IA), con número, título, estado y enlace |
| AC-007.11 | El contenido del ticket va al modelo como dato no confiable: una instrucción escrita en el ticket no cambia el formato, no agrega destinatarios y no revela notas internas en el borrador público |
| AC-007.12 | Cada uso del copiloto registra en `helpdesk.ai_usage` (función, admin, ticket, tokens y costo) y suma al «Costo de IA» de las métricas. Si el modelo falla, se muestra «El copiloto no está disponible» y el ticket se gestiona igual (D6) |
| AC-007.13 | Solo admin: el solicitante recibe 403 en los endpoints del copiloto y en duplicados, y no ve nada de esto en la UI |

## Fuera de alcance

- Horario laboral y calendarios de feriados.
- Alertas por vencimiento.
- Exportar a CSV.
- Fusionar duplicados (solo se muestran).
- Clasificación o asignación automática con IA.
