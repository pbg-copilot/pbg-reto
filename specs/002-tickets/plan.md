# 002 · Plan

## Migración `0002_tickets`

```sql
CREATE TABLE helpdesk.categories (
  code text PRIMARY KEY,                       -- access, permissions, screens, uploads, unexpected, other
  name text NOT NULL, sort int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE helpdesk.priorities (
  code text PRIMARY KEY,                       -- low, medium, high, urgent
  name text NOT NULL, rank int NOT NULL UNIQUE,
  first_response_target_minutes int,          -- NULL = sin objetivo (no se promete plazo)
  resolution_target_minutes int,
  is_active boolean NOT NULL DEFAULT true
);
CREATE SEQUENCE helpdesk.ticket_number_seq;
CREATE TABLE helpdesk.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number bigint NOT NULL UNIQUE DEFAULT nextval('helpdesk.ticket_number_seq'),
  title text NOT NULL CHECK (length(title) BETWEEN 3 AND 160),
  original_description text NOT NULL,          -- reporte del usuario, sin cambios
  ai_summary jsonb,                            -- datos del caso + resumen generado por IA
  requester_id text NOT NULL REFERENCES onboarding.accounts(id),
  category_code text NOT NULL REFERENCES helpdesk.categories(code),
  impact text NOT NULL DEFAULT 'medium' CHECK (impact IN ('low','medium','high','critical')),
  priority_code text NOT NULL REFERENCES helpdesk.priorities(code),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','closed')),
  assignee_id text REFERENCES onboarding.accounts(id),
  source text NOT NULL CHECK (source IN ('assistant','manual_form','human_request')),
  conversation_id uuid UNIQUE,                 -- FK en 0004; un ticket por conversación
  incident_id uuid,                            -- FK en 0003
  attempted_steps jsonb NOT NULL DEFAULT '[]', -- [{step, result, article_id?, article_version?}]
  tags text[] NOT NULL DEFAULT '{}',
  closure_reason text CHECK (closure_reason IN ('resolved','duplicate','invalid','no_response','other')),
  resolution_summary text,
  duplicate_of_ticket_id uuid REFERENCES helpdesk.tickets(id),
  reopened_count int NOT NULL DEFAULT 0,
  version int NOT NULL DEFAULT 1,
  first_response_at timestamptz,               -- 1er comentario público de un admin
  last_team_reply_at timestamptz,
  last_requester_reply_at timestamptz,
  last_public_activity_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_requester_idx ON helpdesk.tickets (requester_id, status, last_public_activity_at DESC);
CREATE INDEX tickets_admin_idx ON helpdesk.tickets (status, priority_code, last_activity_at DESC);
CREATE INDEX tickets_title_trgm ON helpdesk.tickets USING gin (helpdesk.immutable_unaccent(title) gin_trgm_ops);

CREATE TABLE helpdesk.ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES onboarding.accounts(id),
  visibility text NOT NULL CHECK (visibility IN ('public','internal')),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  requests_info boolean NOT NULL DEFAULT false,
  edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE helpdesk.ticket_comment_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES helpdesk.ticket_comments(id) ON DELETE CASCADE,
  previous_body text NOT NULL, edited_by text NOT NULL, edited_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE helpdesk.ticket_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
  actor_id text REFERENCES onboarding.accounts(id),          -- NULL = sistema
  type text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('public','internal')),
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE helpdesk.ticket_reads (
  account_id text NOT NULL REFERENCES onboarding.accounts(id),
  ticket_id uuid NOT NULL REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, ticket_id)
);
```

**Seeds:**
- Categorías:

  | Código | Nombre |
  | --- | --- |
  | `access` | Acceso |
  | `permissions` | Permisos |
  | `screens` | Funcionamiento de pantallas |
  | `uploads` | Carga de archivos |
  | `unexpected` | Comportamiento inesperado |
  | `other` | Otro |

- Prioridades: Baja, Media, Alta y Urgente, sin objetivos (`NULL`). El admin los
  configura en 007.
- Prioridad inicial según el impacto: `low → low`, `medium → medium`,
  `high → high`, `critical → urgent`. El admin la puede cambiar.

**Tipos de evento:**

| Evento | Visibilidad |
| --- | --- |
| `created` | public |
| `status_changed` (`from`, `to`, `reason`) | public |
| `reopened` | public |
| `assigned` (`from`, `to`) | internal |
| `priority_changed` | internal |
| `category_changed` | internal |
| `tags_changed` | internal |
| `comment_added` | según el comentario |
| `comment_edited` | según el comentario |
| `attachment_added` (006) | según el adjunto |
| `attachment_removed` (006) | según el adjunto |
| `incident_linked` (003) | public |

## Módulo `backend/src/modules/tickets/`

| Archivo | Responsabilidad |
| --- | --- |
| `state-machine.ts` | Función pura `transition(ticket, to, input) → { ok, changes } \| { error }`. Cubre todas las reglas. Tests unitarios sin base de datos |
| `policy.ts` | `canView`, `canComment(visibility)`, `canChangeStatus`, `canReopen`, `canAssign`. Se usa en el servicio y en la construcción de las consultas |
| `repository.ts` | Consultas Kysely que **siempre** reciben `actor`: el solicitante añade `requester_id = actor.id`; el solicitante nunca recibe filas `internal`. El `UPDATE` lleva `version`, `RETURNING *` y `version = version + 1` |
| `service.ts` | Orquesta transacciones: `create`, `list`, `get`, `comment`, `changeStatus`, `assign`, `update`, `reopen`. Llama a `events.recordEvent(tx, …)` |
| `events.ts` | `recordEvent(tx, event)`: inserta en `ticket_events` y luego corre los listeners registrados (005 agrega notificaciones). Los listeners reciben la misma `tx` |
| `serializers.ts` | `toRequesterTicket` / `toAdminTicket`. El esquema zod de respuesta para el solicitante no tiene campos internos (asignación interna, etiquetas internas, notas) |
| `routes.ts` | Endpoints de `000-overview/api-conventions.md` |

**Actividad y "sin leer":**
- Toda actividad pública actualiza `last_public_activity_at` y `last_activity_at`;
  la interna solo `last_activity_at`.
- `unread` para el solicitante: `last_public_activity_at > coalesce(last_read_at, '-infinity')`.
- `unread` para el admin: lo mismo con `last_activity_at`.
- La actividad propia no cuenta como no leída: al escribir, se actualiza también
  `ticket_reads` del autor.

**Primera respuesta:** el primer comentario `public` de un admin que no sea el
solicitante fija `first_response_at`, si era nulo. Cada comentario público del equipo
actualiza `last_team_reply_at`.

**Búsqueda `q`:**
- Si es un número o `TCK-123`, filtra por `number`.
- Si no, `immutable_unaccent(title) ILIKE` o `original_description ILIKE`, con el
  patrón parametrizado y escapado.

**Concurrencia:**
- `PATCH` usa `UPDATE … WHERE id=$1 AND version=$2`.
- Si afecta 0 filas, se distingue con un `SELECT` del ticket visible:
  - si no existe para el actor → 404;
  - si existe → 409 con `details.current`.

**Admins asignables:** `GET /support/admins` devuelve `id, name, email` de
`reto.agents` con `role = 'admin'`.

## Esquemas compartidos (`packages/shared/src/tickets.ts`)

- Tipos y enums: `TicketStatus`, `ClosureReason`, `Impact`, etiquetas en español
  (`statusLabel`).
- Bodies: `CreateTicketBody`, `ChangeStatusBody`, `AssignBody`, `UpdateTicketBody`,
  `ReopenBody`, `CommentBody`.
- Consulta: `ListTicketsQuery`.
- Respuestas: `RequesterTicket`, `AdminTicket`, `TicketDetail`, `TicketEvent`,
  `Comment`.

## Frontend `features/tickets/`

| Ruta | Pantalla |
| --- | --- |
| `/tickets` | `TicketsPage`: pestañas con contador, búsqueda con debounce, filtros (Sheet en móvil), tabla responsive (tarjetas en móvil), paginación. La query vive en la URL (search params) |
| `/tickets/nuevo` | `NewTicketPage`: formulario manual |
| `/tickets/:id` | `TicketDetailPage` |

`TicketDetailPage` tiene:
- **Columna principal:**
  - encabezado con número, título, badge de estado y prioridad;
  - bloque "Reporte original" y "Resumen del asistente (IA)" diferenciados;
  - pasos intentados;
  - hilo de comentarios, con las notas internas sobre fondo dorado y la etiqueta
    "Nota interna · solo equipo".
- **Lateral:** estado, responsable, categoría, prioridad, fechas, conversación de
  origen e historial.
- **Acciones del admin:** cambiar estado con un diálogo que exige motivo o resumen al
  cerrar, asignar y editar atributos.
- **Acciones del solicitante:** responder y reabrir (diálogo con motivo).

Conflicto 409:
- Un `Alert` con "Otro administrador actualizó este ticket" muestra el estado actual
  y ofrece dos acciones: "Aplicar mi cambio sobre la versión nueva" o "Descartar".
- El texto escrito se conserva en el estado del formulario.

Mutaciones con TanStack Query:
- Al terminar invalidan `['tickets', id]` y `['tickets', 'list']`.
- Nada de optimistic updates en cambios de estado: se espera la confirmación del
  backend.

## Tests

| Nivel | Qué cubre |
| --- | --- |
| Unitarios | `state-machine` (todas las combinaciones, mismo estado, motivos) y `policy` |
| Integración (`inject`) | Matriz de permisos: dueño, otro solicitante, dueño de la misma agencia y admin; aislamiento de notas internas en listado, detalle, eventos y `unread`; idempotencia del create; conflicto de versión con dos admins (`agente015` y `agente104`); reabrir; comentar un ticket cerrado |
| E2E (008) | Partes de D3, D4, D5 y D6 |
