# 006 · Tareas

- [ ] **T006.1** Migración `0006_attachments`.
  Test: idempotente; el `CHECK` exige `ticket_id` o `conversation_id`.
- [ ] **T006.2** Lista blanca de tipos y límites compartidos en
  `packages/shared/src/attachments.ts`.
- [ ] **T006.3** `storage.ts` (adaptador S3).
  Test de integración: `put`, `get` y `delete` contra el `s3` de compose.
- [ ] **T006.4** `validation.ts`: `sanitizeFilename` y `detectType`.
  Tests unitarios con fixtures en `backend/test/fixtures/files/`. → AC-006.3
- [ ] **T006.5** `POST /tickets/:id/attachments` con multipart, idempotencia,
  visibilidad heredada, evento y compensación en S3.
  Tests: permisos, 413, 415, sin huérfanos. → AC-006.1, AC-006.3, AC-006.4
- [ ] **T006.6** `POST /support/conversations/:id/attachments` y vinculación al
  ticket en `create_ticket` y `escalate`.
  Test: al escalar, el ticket tiene los adjuntos. → AC-006.2
- [ ] **T006.7** `GET /attachments/:id/download` con autorización y headers
  seguros.
  Tests: ajeno o interno → 404 para el solicitante; headers correctos. → AC-006.5, AC-006.6
- [ ] **T006.8** `DELETE /attachments/:id` con soft delete y evento.
  Tests: solo admin; descarga posterior → 404; queda trazabilidad. → AC-006.7
- [ ] **T006.9** Metadatos de adjuntos en el contexto del asistente (004).
  Test: el input al proveedor no contiene bytes del archivo. → AC-006.8
- [ ] **T006.10** UI: `Dropzone`, `AttachmentList`, chips en el chat y diálogo para
  retirar. → AC-006.9
- [ ] **T006.11** Política de archivos en el README. → AC-006.10
- [ ] **T006.12** *(Should)* Consentimiento por imagen en el compositor y
  `shared_with_ai_at`. → AC-006.11
- [ ] **T006.13** *(Should)* Bloque `image` solo en el turno con consentimiento y
  marcador en el historial guardado.
  Test con `fake`: sin consentimiento no hay bloque `image`; con consentimiento sí, y
  el historial no guarda base64. → AC-006.12, AC-006.13
