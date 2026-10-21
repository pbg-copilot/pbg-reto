# 003 · Tareas

- [ ] **T003.1** Migración `0003_catalog` (FK diferida y FK de incidente en
  tickets).
  Test: idempotente; insertar un artículo y su versión en una sola transacción.
- [ ] **T003.2** Esquemas zod compartidos (`articles.ts`, `incidents.ts`).
- [ ] **T003.3** Seeds: 12 artículos y 1 incidente, todos marcados como ejemplo.
  Test: correr dos veces mantiene 12 artículos y todos con `is_example`. → AC-003.5
- [ ] **T003.4** `search.ts` con full-text más trigramas.
  Tests: "contrasena", "sesion se cierra", typo "inciar sesion" y filtro por
  categoría. → AC-003.3, AC-003.4
- [ ] **T003.5** Lectura: `GET /support/articles` y `GET /support/articles/:idOrSlug`
  con visibilidad por rol.
  Tests: el solicitante no ve borradores, archivados ni vencidos; el admin
  sí. → AC-003.1, AC-003.3
- [ ] **T003.6** Escritura admin: create, versions, publish y archive, con
  `version`.
  Tests: 403 para no admin; versión inmutable; publicar la v2 mantiene legible la
  v1. → AC-003.2, AC-003.6
- [ ] **T003.7** *(Should)* `fromTicket` + `redactPersonalData`.
  Tests: rechaza tickets no resueltos; el borrador no contiene correo, teléfono,
  nombre, número de ticket ni texto de nota interna. → AC-003.7
- [ ] **T003.8** *(Should)* Incidentes: CRUD admin, vista pública y vínculo con
  ticket.
  Tests: la vista pública no tiene tickets; el evento
  `incident_linked`. → AC-003.8, AC-003.9
- [ ] **T003.9** UI admin del catálogo (lista, editor, versiones y
  acciones). → AC-003.10
- [ ] **T003.10** UI de lectura `/soporte/articulos/:slug`. → AC-003.11
- [ ] **T003.11** *(Should)* UI de incidentes y botón "Crear artículo desde este
  ticket".
