# 006 · Plan

## Migración `0006_attachments`

```sql
CREATE TABLE helpdesk.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES helpdesk.tickets(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES helpdesk.conversations(id) ON DELETE CASCADE,
  comment_id uuid REFERENCES helpdesk.ticket_comments(id),
  uploader_id text NOT NULL REFERENCES onboarding.accounts(id),
  visibility text NOT NULL CHECK (visibility IN ('public','internal')),
  original_name text NOT NULL CHECK (length(original_name) <= 200),
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','removed')),
  removed_at timestamptz, removed_by text REFERENCES onboarding.accounts(id), removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ticket_id IS NOT NULL OR conversation_id IS NOT NULL)
);
CREATE INDEX attachments_ticket_idx ON helpdesk.attachments (ticket_id) WHERE ticket_id IS NOT NULL;
CREATE INDEX attachments_conversation_idx ON helpdesk.attachments (conversation_id) WHERE conversation_id IS NOT NULL;
```

## Módulo `modules/attachments/`

| Archivo | Responsabilidad |
| --- | --- |
| `storage.ts` | Adaptador S3 con `@aws-sdk/client-s3` (`forcePathStyle`, endpoint interno `s3:9000`): `put(key, stream, meta)`, `getStream(key)`, `delete(key)`. Solo lo usa el backend; el bucket nunca se expone al navegador |
| `validation.ts` | `sanitizeFilename`: basename, quita caracteres de control y `/\`, recorta a 200 y normaliza Unicode NFC. `detectType(buffer)` con `file-type` sobre los primeros 4100 bytes más las reglas de texto. Lista blanca `mime ↔ extensiones`. Si no coinciden, 415 |
| `service.ts` | `upload(actor, target, files, visibility, commentId?)`, `download(actor, id, inline)`, `remove(admin, id, reason)` |
| `routes.ts` | Endpoints de la spec |

**Subida:**
1. `@fastify/multipart` con `limits: { fileSize: UPLOAD_MAX_BYTES, files: UPLOAD_MAX_FILES, fields: 5 }`.
2. Cada archivo se lee a un buffer acotado (máximo 10 MB × 5) mientras se calcula el
   SHA-256.
3. Se valida el tipo.
4. Se sube a S3 **antes** de la transacción, con una clave UUID.
5. Transacción: se insertan las filas y se llama a `recordEvent('attachment_added', visibility)`.
6. Si la transacción falla, se borran de S3 las claves subidas (compensación). Un
   huérfano raro lo limpia un job semanal (documentado).

**Visibilidad:**
- Si hay `comment_id`, el adjunto hereda la visibilidad del comentario. Pedir otra
  visibilidad da 400.
- El solicitante siempre sube `public`.

**Descarga:**
1. Consulta con scoping (como en 002) más `status = 'active'`.
2. Si no hay fila visible para el actor, 404.
3. Se hace streaming desde S3 a la respuesta con los headers de la spec.
   `Content-Type` es el `mime_type` guardado, nunca el que declaró el cliente.

**Chat:**
- Los adjuntos de la conversación se suben con `conversation_id`.
- `create_ticket` y `escalate` ejecutan `UPDATE attachments SET ticket_id = $t WHERE conversation_id = $c`
  dentro de su transacción.

**nginx:** `client_max_body_size 55m` (5 × 10 MB más margen) solo en
`location ~ ^/(tickets/[^/]+/attachments|support/conversations/[^/]+/attachments)$`;
en el resto, 1 MB.

## Frontend

- `components/attachments/Dropzone.tsx`: `input type=file` accesible, arrastrar y
  soltar, validación en el cliente con la misma lista que `packages/shared`, y
  progreso con `XMLHttpRequest`, porque `fetch` no informa el progreso de subida.
- `AttachmentList.tsx`:
  - nombre, autor, fecha, tamaño y visibilidad (badge "Interno" en dorado);
  - miniaturas de imágenes con `<img src="/attachments/:id/download?inline=1">`,
    mismo origen y permitido por la CSP;
  - estado "retirada".
- En el chat, el botón de clip del compositor muestra chips de los archivos subidos
  antes de enviar el mensaje.
- El admin tiene la acción "Retirar evidencia", con un diálogo que pide el motivo.

## Tests

| Nivel | Qué cubre |
| --- | --- |
| Unitarios | `sanitizeFilename`; `detectType` con PNG real, PNG renombrado a `.pdf`, HTML disfrazado de `.png`, SVG, texto con bytes nulos y archivo vacío |
| Integración (S3 real de compose) | Subida y descarga del dueño; un tercero recibe 404; el solicitante no ve los internos ni en el detalle ni por descarga directa; 413 y 415 no dejan objetos en el bucket; retirar deja la descarga en 404 para todos y crea el evento; los adjuntos del chat pasan al ticket al escalar; reintento con la misma clave no duplica |

## Visión con consentimiento (AC-006.11 a AC-006.13)

- **Datos:**
  - `attachments.shared_with_ai_at timestamptz NULL`;
  - `POST /support/conversations/:id/messages` acepta `attachment_ids` y
    `share_images_with_ai: boolean`.
- **Servidor:**
  - solo imágenes de esa conversación, de quien envía y en estado `active`;
  - se leen desde S3 y se agrega `{ type: "image", source: { type: "base64", media_type, data } }`
    antes del texto, en el mensaje `user` de ese turno;
  - en el historial guardado queda un marcador `{ type: "attachment_image", attachment_id }`,
    que cada turno convierte en el mismo bloque `image` leído de S3. El historial no cambia
    entre turnos (Haiku 5.5 rechaza con 400 un historial editado) y el binario no se guarda
    en PostgreSQL.
- **Tests:** un proveedor que registra lo que recibe el modelo comprueba que sin
  consentimiento no hay bloque `image` y que con consentimiento sí, estable entre turnos.
- **Costo:** con Haiku 5.5, una captura típica suma ~1.500 tokens de entrada por turno
  (≈ US$0.00015) desde que se comparte.
