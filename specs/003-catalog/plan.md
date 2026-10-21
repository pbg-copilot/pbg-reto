# 003 · Plan

## Migración `0003_catalog`

```sql
CREATE TABLE helpdesk.articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  category_code text NOT NULL REFERENCES helpdesk.categories(code),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  is_example boolean NOT NULL DEFAULT true,
  published_version_id uuid,                    -- FK diferida abajo
  source_ticket_id uuid REFERENCES helpdesk.tickets(id),
  version int NOT NULL DEFAULT 1,               -- concurrencia del registro
  created_by text REFERENCES onboarding.accounts(id),  -- NULL en seeds
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE TABLE helpdesk.article_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES helpdesk.articles(id) ON DELETE CASCADE,
  version int NOT NULL,
  title text NOT NULL,
  symptoms text NOT NULL,
  applies_to text NOT NULL DEFAULT '',          -- plataforma / versión
  diagnosis_steps text NOT NULL,
  solution text NOT NULL,
  escalation_conditions text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  reviewed_at date NOT NULL DEFAULT current_date,
  valid_until date,
  created_by text REFERENCES onboarding.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish', helpdesk.immutable_unaccent(title)), 'A') ||
    setweight(to_tsvector('spanish', helpdesk.immutable_unaccent(symptoms)), 'A') ||
    setweight(to_tsvector('spanish', helpdesk.immutable_unaccent(array_to_string(tags,' '))), 'B') ||
    setweight(to_tsvector('spanish', helpdesk.immutable_unaccent(solution || ' ' || diagnosis_steps)), 'C')
  ) STORED,
  UNIQUE (article_id, version)
);
CREATE INDEX article_versions_search_idx ON helpdesk.article_versions USING gin (search_vector);
CREATE INDEX article_versions_title_trgm ON helpdesk.article_versions USING gin (helpdesk.immutable_unaccent(title) gin_trgm_ops);
ALTER TABLE helpdesk.articles ADD CONSTRAINT articles_published_version_fk
  FOREIGN KEY (published_version_id) REFERENCES helpdesk.article_versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE helpdesk.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  public_summary text NOT NULL,
  status text NOT NULL CHECK (status IN ('investigating','identified','monitoring','resolved')),
  category_code text REFERENCES helpdesk.categories(code),
  article_id uuid REFERENCES helpdesk.articles(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_by text REFERENCES onboarding.accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE helpdesk.tickets ADD CONSTRAINT tickets_incident_fk
  FOREIGN KEY (incident_id) REFERENCES helpdesk.incidents(id);
```

`to_tsvector('spanish', …)` con el regconfig literal es IMMUTABLE. Combinado con
`immutable_unaccent`, la columna generada es válida.

## Búsqueda (`modules/articles/search.ts`)

```sql
WITH q AS (SELECT websearch_to_tsquery('spanish', helpdesk.immutable_unaccent($1)) AS tsq)
SELECT a.id, a.slug, a.category_code, v.id AS version_id, v.version, v.title, v.symptoms,
       ts_rank_cd(v.search_vector, q.tsq) AS rank,
       similarity(helpdesk.immutable_unaccent(v.title), helpdesk.immutable_unaccent($1)) AS sim
FROM helpdesk.articles a
JOIN helpdesk.article_versions v ON v.id = a.published_version_id
CROSS JOIN q
WHERE a.status = 'published' AND (v.valid_until IS NULL OR v.valid_until >= current_date)
  AND (v.search_vector @@ q.tsq OR helpdesk.immutable_unaccent(v.title) % helpdesk.immutable_unaccent($1))
  AND ($2::text IS NULL OR a.category_code = $2)
ORDER BY rank DESC, sim DESC
LIMIT $3;
```

- El admin usa la misma consulta sin el filtro de publicados, sobre la última
  versión, y con filtro por `status`.
- Sin `q`, el listado se ordena por `updated_at DESC`.

## Servicio y rutas (`modules/articles/`)

- `create`: crea `articles` como `draft` y su `article_versions` versión 1.
- `newVersion(articleId, body, version)`: inserta `max(version)+1` y deja el artículo
  en `draft` si no estaba publicado. Si estaba publicado, sigue publicado con la
  versión anterior hasta que se publique la nueva.
- `publish(articleId, versionId, version)`: fija `published_version_id`,
  `status = 'published'` y `archived_at = null`.
- `archive(articleId, version)`: `status = 'archived'`. El chat deja de usarlo.
- `fromTicket(ticketId)`: arma el borrador con una **lista blanca** de campos.
  - Pasa el texto por `redactPersonalData()`, que reemplaza correos, teléfonos, el
    nombre del solicitante, `TCK-\d+` y UUIDs por marcadores. Un test lo verifica.
  - Lo marca `is_example = false`, porque es un procedimiento derivado de un caso real
    y el admin decide si publicarlo.
- `getForReader(idOrSlug, versionNumber?)`: el solicitante puede leer una versión
  concreta **solo** si es o fue publicada (`id` referenciado alguna vez por
  `published_version_id`, o presente en `article_refs` de una conversación suya).
  - Simplificación aceptada: cualquier versión de un artículo no borrador.
- Incidentes: CRUD admin. La vista pública usa una proyección limitada
  (`id, title, public_summary, status, started_at, article slug`).

## Seeds (`backend/src/db/seeds/articles.ts`)

Doce artículos ficticios y una versión publicada de cada uno. El slug es la clave
natural para la idempotencia.

| Slug | Categoría | Tema (ficticio) |
| --- | --- | --- |
| `no-puedo-iniciar-sesion` | access | Credenciales y bloqueo por intentos |
| `restablecer-contrasena-no-llega` | access | Correo de restablecimiento que no llega (spam, espera) |
| `sesion-se-cierra-sola` | access | Sesión única por cuenta; otro dispositivo cierra la sesión |
| `no-veo-modulo-permisos` | permissions | Módulo no visible por rol; a quién pedir acceso |
| `dueno-agencia-no-ve-tickets-de-su-equipo` | permissions | Explica que la agencia no da acceso a tickets ajenos |
| `pantalla-en-blanco-tras-actualizar` | screens | Caché del navegador, recarga forzada, navegador soportado |
| `boton-guardar-no-responde` | screens | Validaciones del formulario y conexión |
| `tabla-no-carga-datos` | screens | Filtros activos y rango de fechas |
| `archivo-rechazado-por-tipo-o-tamano` | uploads | Tipos permitidos y límite de 10 MB |
| `carga-de-archivo-se-queda-en-progreso` | uploads | Conexión inestable, reintento |
| `datos-desactualizados-despues-de-guardar` | unexpected | Actualización periódica, recargar |
| `mensaje-de-error-inesperado` | unexpected | Cómo reportar: hora, pantalla, captura; escalar |

Además hay un incidente seed, *"Lentitud al cargar listados (ejemplo)"*, en estado
`identified` y vinculado a `tabla-no-carga-datos`, para demostrar §03.

## UI

| Ruta | Contenido |
| --- | --- |
| `/admin/catalogo` | Tabla de artículos (título, categoría, estado, versión publicada y última, revisado, badge Ejemplo) y filtros |
| `/admin/catalogo/nuevo` y `/admin/catalogo/:id` | Formulario por secciones (Síntomas, Diagnóstico, Solución, Escalación), vista previa en Markdown, lista de versiones con "Publicar esta versión", archivar |
| `/admin/incidentes` | Lista y formulario simple (*Should*) |
| `/soporte/articulos/:slug` | Lectura con `react-markdown` sin HTML crudo |

En el detalle de un ticket cerrado como `resolved`, el admin ve el botón
"Crear artículo desde este ticket".

## Tests

| Nivel | Qué cubre |
| --- | --- |
| Integración | Búsqueda con y sin acentos y con typo; el solicitante no ve borradores, archivados ni vencidos; versionado y publicación; 403 para no admin; `fromTicket` no filtra datos personales ni notas internas (fixture con correo, teléfono y nota interna); vista pública de incidentes sin tickets |
| Unitario | `redactPersonalData` |
