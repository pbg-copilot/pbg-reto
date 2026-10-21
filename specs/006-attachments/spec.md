# 006 · Adjuntos y evidencias

- **Estado:** Hecha (2026-10-21)
- **Prioridad:** Must
- **PDF:** §01 (evidencias en el chat), §06, §07, §09
- **Depende de:** 001 (S3), 002, 004

## Problema

Los usuarios y el equipo necesitan compartir capturas y documentos sin que los
archivos queden públicos, sin aceptar archivos peligrosos y respetando la visibilidad
de las notas internas.

## Política de archivos

| Regla | Valor |
| --- | --- |
| Tipos admitidos | PNG, JPEG, WEBP, GIF, PDF y texto plano (`.txt`, `.log`) |
| Tipos rechazados | Todo lo demás. Explícitamente: SVG, HTML, XML, JS, ejecutables, archivos comprimidos y documentos de Office con macros |
| Tamaño máximo | 10 MB por archivo (`UPLOAD_MAX_BYTES`) |
| Archivos por envío | Hasta 5 (`UPLOAD_MAX_FILES`) |
| Validación | En el servidor: magic bytes con `file-type`, que deben coincidir con la extensión. El texto debe ser UTF-8 válido y sin bytes nulos. Se calcula el SHA-256 |
| Almacenamiento | Metadatos en PostgreSQL y binario en un bucket S3 **privado**. La clave es `t/<ticket_id>/<uuid>` o `c/<conversation_id>/<uuid>` y nunca incluye el nombre original |
| Descarga | Por la API, autorizando cada descarga, con `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` y `Cache-Control: private, no-store`. Las imágenes admiten `?inline=1` |
| Retiro | Lo hace un admin y es *soft delete*: el archivo deja de servirse, quedan el registro y el evento con autor, fecha y motivo. El binario se conserva 30 días para auditoría (documentado; sin purga automática en el reto) |
| Antivirus | Fuera de alcance. Se documenta ClamAV como siguiente paso |

## Criterios de aceptación

| ID | Criterio |
| --- | --- |
| AC-006.1 | `POST /tickets/:id/attachments` (multipart con `files[]`, `visibility` y `comment_id` opcional) con `Idempotency-Key`. El solicitante solo sube adjuntos públicos a sus propios tickets. El admin sube públicos o internos. Un ticket ajeno da 404 |
| AC-006.2 | `POST /support/conversations/:id/attachments` permite adjuntar evidencias en el chat. Al escalar, los adjuntos de la conversación se vinculan al ticket |
| AC-006.3 | Un tipo no admitido o que no coincide con su contenido responde 415 `unsupported_file_type`. Pasar el tamaño máximo responde 413 `file_too_large`. Ningún binario rechazado queda en S3 |
| AC-006.4 | Cada adjunto muestra nombre, autor, fecha, tamaño, tipo y visibilidad. Un adjunto de una nota interna hereda `internal` |
| AC-006.5 | `GET /attachments/:id/download` verifica permisos en cada request: el dueño del ticket o conversación solo descarga adjuntos públicos; el admin descarga todos. Un adjunto ajeno o interno, para el solicitante, da 404 (D5) |
| AC-006.6 | Los adjuntos internos no aparecen en ninguna respuesta para el solicitante: detalle, eventos ni contadores (D4) |
| AC-006.7 | `DELETE /attachments/:id` (admin, con `reason`) hace el soft delete y crea el evento `attachment_removed`. La UI muestra "Evidencia retirada por <admin> · fecha · motivo" en lugar del archivo |
| AC-006.8 | Al modelo solo le llegan los metadatos del adjunto (nombre, tipo, tamaño), nunca el contenido |
| AC-006.9 | La UI tiene una zona de arrastrar y soltar más botón, con validación previa en el cliente (tipo y tamaño), progreso, errores claros en español y vista previa de las imágenes ya subidas, a través del endpoint autorizado |
| AC-006.10 | La política de archivos de esta spec queda documentada en el README |

## Lectura de capturas por el asistente (visión) · *Should*

Decidido el 2026-10-21 (ver `docs/adr/0005-ai-capabilities-roadmap.md`).

| ID | Criterio |
| --- | --- |
| AC-006.11 | Al adjuntar una imagen en el chat, el compositor muestra la casilla **«Permitir que el asistente lea esta imagen»**, **desmarcada** por defecto. Sin consentimiento, el modelo solo recibe nombre, tipo y tamaño (AC-006.8) |
| AC-006.12 | Con consentimiento, la imagen (PNG, JPEG, WEBP o GIF, hasta 5 MB) se envía como bloque `image` en base64 **solo en ese mensaje**, y se registra `shared_with_ai_at` en el adjunto. Nunca se envían PDFs, adjuntos internos ni imágenes de tickets |
| AC-006.13 | El asistente puede citar lo que ve («en tu captura aparece el error 500») y sigue sin afirmar causas. El costo de la imagen queda en `usage` |
