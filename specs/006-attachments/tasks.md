# 006 · Tareas

- [x] **T006.1** Migración `0006_attachments`.
  Test: idempotente; el `CHECK` exige `ticket_id` o `conversation_id`.
- [x] **T006.2** Lista blanca de tipos y límites compartidos en
  `packages/shared/src/attachments.ts`.
- [x] **T006.3** `storage.ts` (adaptador S3).
  Test de integración: `put`, `get` y `delete` contra el `s3` de compose.
- [x] **T006.4** `validation.ts`: `sanitizeFilename` y `detectType`.
  Tests unitarios con fixtures en memoria (PNG real, HTML disfrazado, SVG, texto con NUL, vacío). → AC-006.3
- [x] **T006.5** `POST /tickets/:id/attachments` con multipart, idempotencia,
  visibilidad heredada, evento y compensación en S3.
  Tests: permisos, 413, 415, sin huérfanos. → AC-006.1, AC-006.3, AC-006.4
- [x] **T006.6** `POST /support/conversations/:id/attachments` y vinculación al
  ticket en `create_ticket` y `escalate`.
  Test: al escalar, el ticket tiene los adjuntos. → AC-006.2
- [x] **T006.7** `GET /attachments/:id/download` con autorización y headers
  seguros.
  Tests: ajeno o interno → 404 para el solicitante; headers correctos. → AC-006.5, AC-006.6
- [x] **T006.8** `DELETE /attachments/:id` con soft delete y evento.
  Tests: solo admin; descarga posterior → 404; queda trazabilidad. → AC-006.7
- [x] **T006.9** Metadatos de adjuntos en el contexto del asistente (004).
  Test: el input al proveedor no contiene bytes del archivo. → AC-006.8
- [x] **T006.10** UI: `Dropzone`, `AttachmentList`, chips en el chat y diálogo para
  retirar. → AC-006.9
- [x] **T006.11** Política de archivos en el README. → AC-006.10
- [x] **T006.12** *(Should)* Consentimiento por imagen en el compositor y
  `shared_with_ai_at`. → AC-006.11
- [x] **T006.13** *(Should)* Bloque `image` solo en el turno con consentimiento y
  marcador en el historial guardado.
  Test con `fake`: sin consentimiento no hay bloque `image`; con consentimiento sí, y
  el historial no guarda base64. → AC-006.12, AC-006.13

## Notas de implementación

- **Visión: marcador en vez de reemplazo.**
  - En la base de datos el mensaje guarda `{ type: "attachment_image", attachment_id }`.
  - Cada turno lo convierte en el mismo bloque `image`, leído del bucket.
  - Así la imagen se reenvía igual en los turnos siguientes. Haiku 5.5 rechaza con 400 un
    historial editado (verificación de *thinking*), y reemplazar la imagen por un texto
    habría roto las conversaciones.
  - Costo: unos 1.500 tokens de entrada por turno después de compartirla (≈ US$0.00015).
- **Recuperación ante un 400 de prefijo.** Si cambian el system prompt o las herramientas
  (un deploy), el proveedor reintenta una vez sin los bloques *thinking*.
- **Pruebas de visión.** El test usa un proveedor que registra lo que recibe el modelo;
  no cambia las reglas del `fake`.
- **Verificado con Haiku real.**
  - Leyó el mensaje de error de una captura de la pantalla de login.
  - El segundo turno respondió 200 con la misma imagen en el historial.
- **Fuera de esta spec:** antivirus (ClamAV) y la purga de binarios retirados, documentados
  como siguiente paso.
