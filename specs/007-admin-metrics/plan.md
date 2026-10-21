# 007 · Plan

## Backend `modules/metrics/`

No hay migraciones nuevas: usa las columnas de 002 (`first_response_at`,
`last_team_reply_at`, `closed_at`, `reopened_count`) y `conversation_messages.usage`.

`metrics.repository.ts` es una sola consulta con CTE:

```sql
WITH t AS (
  SELECT * FROM helpdesk.tickets WHERE created_at >= $1 AND created_at < $2
),
frt AS (SELECT extract(epoch FROM first_response_at - created_at) AS s, priority_code FROM t WHERE first_response_at IS NOT NULL),
rt  AS (SELECT extract(epoch FROM closed_at - created_at) AS s, priority_code FROM t WHERE status='closed' AND closure_reason='resolved')
SELECT
  (SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM t GROUP BY status) x) AS by_status,
  (SELECT count(*) FROM t WHERE status='open' AND first_response_at IS NULL) AS unattended,
  (SELECT count(*) FROM t WHERE reopened_count > 0) AS reopened,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s) FROM frt) AS frt_p50,
  (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY s) FROM frt) AS frt_p90,
  (SELECT avg(s) FROM frt) AS frt_avg,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY s) FROM rt) AS rt_p50,
  (SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY s) FROM rt) AS rt_p90,
  (SELECT avg(s) FROM rt) AS rt_avg;
```

Hay consultas aparte para:
- el cumplimiento por prioridad (`JOIN priorities` donde el objetivo no es nulo);
- los tickets por categoría;
- el costo de IA, que suma `usage` en un rango sobre `conversation_messages` y aplica
  `pricing.ts`.

En la bandeja, "Desde la última respuesta" se calcula en SQL como
`now() - coalesce(last_team_reply_at, created_at)` y se devuelve en segundos.

## API

| Endpoint | Rol | Notas |
| --- | --- | --- |
| `GET /support/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD` | admin | Por defecto, los últimos 30 días |
| `GET /support/priorities` | sesión | El solicitante solo recibe `code` y `name`, sin objetivos (AC-007.6) |
| `PATCH /support/priorities/:code` | admin | `{ name?, rank?, first_response_target_minutes?, resolution_target_minutes?, is_active? }` |

## Frontend

- **`/tickets` en modo admin:**
  - chips de filtros rápidos: Sin atender, Asignados a mí, Sin asignar, Más de 72 h;
  - acción "Tomar caso" por fila, que asigna y pasa a En revisión en dos PATCH
    secuenciales con su `version`.
- **`/admin/metricas`:**
  - selector de rango;
  - tarjetas KPI: Abiertos, En revisión, Cerrados, Sin atender, TPR p50, TR p50,
    Tasa de reapertura y Costo de IA;
  - tabla por prioridad con objetivo y % de cumplimiento, o "Sin objetivo definido";
  - barras simples por categoría (CSS, sin librería);
  - panel "¿Cómo se calcula?" con las fórmulas de la spec.
- **`/admin/prioridades`:** tabla editable con los objetivos en minutos, usando
  inputs de horas o minutos.

## Copiloto del equipo (AC-007.8 a AC-007.13)

**Migración `0008_ai_usage`:**

```sql
CREATE TABLE helpdesk.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature text NOT NULL CHECK (feature IN ('copilot_summary','copilot_reply')),
  actor_id text NOT NULL REFERENCES onboarding.accounts(id),
  ticket_id uuid REFERENCES helpdesk.tickets(id) ON DELETE SET NULL,
  model text NOT NULL,
  usage jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_created_idx ON helpdesk.ai_usage (created_at);
```

**Módulo `modules/copilot/`:** una sola llamada al modelo, sin herramientas, con el
mismo `AssistantProvider` (y el mismo `fake` en tests).

| Endpoint | Rol | Qué hace |
| --- | --- | --- |
| `POST /tickets/:id/copilot/summary` | admin | Arma el contexto con todo el ticket (incluidas las notas internas) envuelto en `<untrusted_content>`. Devuelve `{ markdown }` |
| `POST /tickets/:id/copilot/reply-draft` | admin | El contexto **excluye** las notas internas por construcción: se usa el serializador del solicitante y no un filtro posterior. Suma los 3 artículos publicados más relevantes (`search.ts`). Devuelve `{ markdown, articles: [{slug, title}] }` |
| `GET /tickets/:id/similar` | admin | `word_similarity` sobre `title \|\| ' ' \|\| description`, umbral 0.35, excluye el propio ticket y los cerrados, máximo 5 |

- Rate limit de 10 llamadas por minuto por admin.
- `max_tokens` de 600.
- Prompt corto en `copilot/prompt.ts`: español, sin inventar causas y sin prometer
  plazos.

**Frontend:**
- En el detalle admin, una tarjeta «Copiloto» con los botones Resumir caso y Sugerir
  respuesta.
- El resumen se muestra en un panel con «Guardar como nota interna».
- El borrador va al `CommentComposer` como texto editable, con el aviso «Revisa antes
  de enviar».
- Una sección «Posibles duplicados» con la lista.

## Tests

| Nivel | Qué cubre |
| --- | --- |
| Integración | Fixtures con fechas controladas (insertados directo en la base dentro de una transacción de test): TPR ignora las notas internas; TR usa el último cierre; un reabierto cuenta en la tasa; el cumplimiento solo aparece con objetivo; 403 para no admin; el solicitante no ve objetivos |
| Integración (copiloto, `fake`) | El input del borrador no contiene el texto de una nota interna; el resumen sí lo contiene. 403 para el solicitante. Cada llamada inserta en `ai_usage` y suma en las métricas. Con `AI_FAKE_FAILURE` → 503 y el ticket sigue operable. `similar` devuelve el ticket parecido y no uno ajeno al tema |
| UI | Smoke de `/admin/metricas`. «Sugerir respuesta» llena el compositor y no envía |
