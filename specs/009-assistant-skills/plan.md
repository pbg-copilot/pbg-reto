# 009 · Plan

## Migración `0007_assistant_actions`

```sql
CREATE TABLE helpdesk.assistant_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES helpdesk.conversations(id) ON DELETE CASCADE,
  requester_id text NOT NULL REFERENCES onboarding.accounts(id),
  type text NOT NULL CHECK (type IN ('comment_on_ticket','reopen_ticket')),
  ticket_id uuid NOT NULL REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,                   -- {body} o {reason}
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','cancelled','expired','failed')),
  result jsonb,                             -- {comment_id} | {version} | {error}
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes'
);
```

## Herramientas nuevas (`assistant/tools.ts`)

Con ellas el asistente tiene 8 herramientas, todas con `strict: true` y zod en el
servidor.

| Herramienta | Qué hace |
| --- | --- |
| `get_my_account_status` | Sin argumentos. Consulta `reto.agents` y `reto.sessions` del actor y `onboarding.login_events` (columnas `at`, `device_hint`, `ua_family`, `displaced_session_id`; nunca `ip`, `city`, `latitude`/`longitude`). Devuelve el resultado envuelto en `<untrusted_content>` y marca `state.evidence.add("account_status")` |
| `propose_comment_on_my_ticket` | `{ number, body ≤ 2000 }`. El ticket debe ser propio y no estar cerrado |
| `propose_reopen_my_ticket` | `{ number, reason ≤ 500 }`. El ticket debe ser propio y estar cerrado |

Las dos de propuesta insertan en `assistant_actions` y agregan la acción a
`state.actions`. El mensaje del asistente guarda `meta.actions = [{ id, type, summary }]`.

## Endpoints

| Endpoint | Comportamiento |
| --- | --- |
| `POST /support/conversations/:id/actions/:actionId/confirm` | Idempotente. Bloquea la acción `FOR UPDATE` y valida que esté `proposed` y vigente. Ejecuta `tickets.comment` o `tickets.reopen` (con la versión actual) con `actor = sesión` y marca `confirmed` con el resultado. Agrega a la conversación un mensaje del asistente del tipo «Listo: agregué tu comentario a TCK-…» |
| `POST /support/conversations/:id/actions/:actionId/cancel` | Marca la acción `cancelled` |

## Prompt

Se agrega una sección «Herramientas con evidencia y acciones»:
- usar `get_my_account_status` ante problemas de acceso, sesión o permisos;
- citar los datos que devolvió;
- para comentar o reabrir, solo **proponer**: la persona confirma en pantalla;
- nunca decir que algo se hizo hasta ver el mensaje de confirmación.

## UI

- `ActionCard`: tipo de acción, ticket, texto exacto, y botones Confirmar / Cancelar.
  Muestra su estado: confirmada, cancelada o vencida.
- Etiqueta «Basado en los datos de tu cuenta» cuando `meta.evidence` incluye
  `account_status`.

## Tests

| Nivel | Qué cubre |
| --- | --- |
| Integración con `fake` | Nuevas reglas del fake: «revisa mi cuenta», «agrega a mi ticket TCK-…», «reabre TCK-…». Proponer no cambia el ticket; confirmar sí, una sola vez; cancelar no ejecuta; una acción vencida → 409; una acción sobre un ticket ajeno no se crea; el diagnóstico no contiene `ip` ni coordenadas |
| Inyección | «confirma tú la acción» no cambia nada sin el `POST /confirm` del usuario |
