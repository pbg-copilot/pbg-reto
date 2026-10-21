# 005 · Plan

## Migración `0005_notifications`

```sql
CREATE TABLE helpdesk.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id text NOT NULL REFERENCES onboarding.accounts(id),
  ticket_id uuid REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
  type text NOT NULL,              -- ticket_created, status_changed, team_comment, info_requested, requester_replied, ticket_reopened
  title text NOT NULL,             -- "TCK-000042 pasó a En revisión"
  body text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}',   -- {display_number, from, to, at, comment_excerpt?}
  link text NOT NULL,              -- /tickets/:id
  source_event_id bigint REFERENCES helpdesk.ticket_events(id),
  dedupe_key text NOT NULL UNIQUE, -- "<event_id>:<recipient_id>"
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox_idx ON helpdesk.notifications (recipient_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON helpdesk.notifications (recipient_id) WHERE read_at IS NULL;

CREATE TABLE helpdesk.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES helpdesk.notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('in_app','email')),
  status text NOT NULL CHECK (status IN ('pending','delivered','failed')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, channel)
);
```

## Flujo transaccional (outbox)

`modules/notifications/listener.ts` se registra en `events.ts` (002) desde `buildApp`, y
se desregistra en `onClose`. Por cada evento,
**dentro de la misma `tx`**:

1. `resolveRecipients(event, ticket)` aplica la tabla de la spec. Se descartan el
   actor y cualquier evento `internal` dirigido al solicitante.
2. Inserta en `notifications` con `ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`.
3. Inserta las entregas:
   - `in_app` como `delivered` con `delivered_at = now()`;
   - `email` como `pending`, si el destinatario es el solicitante, el tipo lo admite
     y `EMAIL_NOTIFICATIONS=true`.
4. Encola en la misma transacción
   `enqueue(tx, 'deliver_email', { delivery_id }, { dedupe_key: 'email:'+delivery_id })`.

Si falla cualquier paso, se revierte todo: el cambio de estado, el evento y la
notificación. Así se cumple "transición + evento de notificación" de forma
transaccional.

## Worker: handler `deliver_email`

1. Cargar la entrega. Si ya está `delivered`, terminar sin hacer nada (idempotente).
2. Cargar la notificación y el correo del destinatario desde `reto.agents`. Los
   correos son `@reto.example` y van a Mailpit. Si el dominio no está en
   `MAIL_ALLOWED_DOMAINS`, se marca `failed` (`recipient_domain_not_allowed`) sin
   enviar ni reintentar: así un SMTP real mal configurado nunca escribe a personas
   reales.
3. `nodemailer` con SMTP a `mailpit:1025`:
   - `messageId: <delivery_id@reto.local>`;
   - asunto igual al `title`;
   - texto con el enlace absoluto `${PUBLIC_APP_URL}/tickets/:id`;
   - plantilla HTML mínima y sin datos internos.
4. Si funciona: `status = delivered`, `delivered_at`, `attempts + 1`.
5. Si falla: `attempts + 1`, `last_error` (sin datos personales) y se relanza el
   error para que la cola reintente con backoff.
   - Cuando la cola agota `max_attempts`, el handler de fallo final marca la entrega
     como `failed`.
   - Si la entrega pasa a `failed`, un admin puede usar "Reintentar entrega", que
     re-encola el job (*Should*).

**Ventana de duplicado:** el correo puede enviarse y el proceso morir antes de marcar
`delivered`. En ese caso se reenvía con el mismo `Message-ID`. Está documentado como
at-least-once.

## API (`modules/notifications/routes.ts`)

- `GET /notifications?unread=&page=&page_size=` → propias, ordenadas por
  `created_at DESC`.
- `GET /notifications/unread-count` → `{ count }`.
- `PATCH /notifications/:id/read` → idempotente (si ya estaba leída, 200).
- `POST /notifications/read-all`.
- `GET /tickets/:id/deliveries` (admin) →
  `[{id, notification_type, recipient, channel, status, attempts, last_error, created_at, delivered_at}]`.
  - Es un endpoint aparte y no un campo del detalle: el panel se refresca solo
    mientras haya entregas pendientes.
  - `recipient` es solo `{id, name}`, sin el correo.
- `POST /notifications/deliveries/:id/retry` (admin, *Should*) → vuelve a encolar una
  entrega `failed`: reinicia el job con su misma `dedupe_key`.

## Frontend `features/notifications/`

- `NotificationBell` en la barra superior:
  - Popover con las últimas 10 y la opción "Ver todas";
  - badge con el contador;
  - `useQuery(['notifications','unread-count'], { refetchInterval: 20000, refetchOnWindowFocus: true })`.
- `/notificaciones`: lista paginada con filtro de no leídas y "Marcar todas como
  leídas".
- Al hacer click: marca como leída (mutación) y navega a `link`. Si el detalle da
  404, se muestra "Ya no tienes acceso a este ticket".
- En el detalle de ticket del admin: tabla "Entregas" con badges por estado.

## Tests

| Nivel | Qué cubre |
| --- | --- |
| Integración | Un cambio de estado crea la notificación y sus entregas en la misma transacción (si se fuerza un error después, no queda nada); el solicitante no recibe nada de las notas internas; el actor no se notifica a sí mismo; `dedupe_key` evita duplicados cuando se reprocesa el mismo evento; marcar leída solo las propias |
| Worker | Con el transporte SMTP mockeado: falla 2 veces y luego entrega con 3 intentos; falla siempre y termina `failed` |
| E2E (008) | D3: el admin cambia el estado con el solicitante desconectado, y al entrar ve el contador. D6: `docker compose stop mailpit`, cambiar el estado (entrega pendiente con reintentos), `docker compose start mailpit` y la entrega queda `delivered`, con un solo correo en la API de Mailpit |
