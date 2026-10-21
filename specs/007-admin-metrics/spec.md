# 007 · Gestión administrativa y métricas

- **Estado:** Borrador
- **Prioridad:** Should (la bandeja y los filtros básicos ya son Must en 002)
- **PDF:** §07
- **Depende de:** 002, 004 (costos de IA)

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

## Fuera de alcance

- Horario laboral y calendarios de feriados.
- Alertas por vencimiento.
- Exportar a CSV.
