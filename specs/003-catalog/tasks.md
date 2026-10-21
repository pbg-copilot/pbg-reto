# 003 · Tareas

- [x] **T003.1** Migración `0003_catalog` (FK diferida y FK de incidente en
  tickets).
  Test: idempotente; insertar un artículo y su versión en una sola transacción.
- [x] **T003.2** Esquemas zod compartidos (`articles.ts`, `incidents.ts`).
- [x] **T003.3** Seeds: 12 artículos y 1 incidente, todos marcados como ejemplo.
  Test: correr dos veces mantiene 12 artículos y todos con `is_example`. → AC-003.5
- [x] **T003.4** `search.ts` con full-text más trigramas.
  Tests: "contrasena", "sesion se cierra", typo "inciar sesion" y filtro por
  categoría. → AC-003.3, AC-003.4
- [x] **T003.5** Lectura: `GET /support/articles` y `GET /support/articles/:idOrSlug`
  con visibilidad por rol.
  Tests: el solicitante no ve borradores, archivados ni vencidos; el admin
  sí. → AC-003.1, AC-003.3
- [x] **T003.6** Escritura admin: create, versions, publish y archive, con
  `version`.
  Tests: 403 para no admin; versión inmutable; publicar la v2 mantiene legible la
  v1. → AC-003.2, AC-003.6
- [x] **T003.7** *(Should)* `fromTicket` + `redactPersonalData`.
  Tests: rechaza tickets no resueltos; el borrador no contiene correo, teléfono,
  nombre, número de ticket ni texto de nota interna. → AC-003.7
- [x] **T003.8** *(Should)* Incidentes: CRUD admin, vista pública y vínculo con
  ticket.
  Tests: la vista pública no tiene tickets; el evento
  `incident_linked`. → AC-003.8, AC-003.9
- [x] **T003.9** UI admin del catálogo (lista, editor, versiones y
  acciones). → AC-003.10
- [x] **T003.10** UI de lectura `/soporte/articulos/:slug`. → AC-003.11
- [x] **T003.11** *(Should)* UI de incidentes y botón "Crear artículo desde este
  ticket".

## Notas de implementación (2026-10-20)

- **Gestión separada de la lectura:** `GET /support/articles/:idOrSlug` es la vista
  de lectura y `GET /support/articles/:id/manage` (solo admin) trae todas las
  versiones y el ticket de origen.
- **Concurrencia de artículos:**
  - Nueva versión exige `base_version`; si es vieja, responde 409.
  - Publicar y archivar son idempotentes.
  - No hay columna `version` en `articles`.
- **`published_at` en `article_versions`:** se fija al publicar y nunca se borra.
  El solicitante puede leer cualquier versión publicada alguna vez, porque una
  conversación pudo usarla aunque el artículo esté archivado.
- **Búsqueda:**
  - full-text con OR entre palabras, más `word_similarity` (trigramas) en el título;
  - `helpdesk.tags_text()` envuelve `array_to_string` (es STABLE) para poder usarla
    en la columna generada.
- **Vínculo con incidentes:** `PATCH /tickets/:id` acepta `incident_id`, que genera el
  evento público `incident_linked`. El detalle del ticket trae `incident` con id,
  título y estado.
- **Autenticación antes de validar:** los guards pasaron a `preValidation`. Sin
  permiso, la API responde 401/403 antes que 400 y no revela el esquema.
- **Fechas:** las columnas `date` llegan como `YYYY-MM-DD`
  (`pg.types.setTypeParser(1082)`).

**Verificación:**
- `pnpm test:unit`: 53/53 (7 nuevos).
- `pnpm test:ui`: 11/11 (2 nuevos).
- Seed: 12 artículos de ejemplo publicados y 1 incidente.
