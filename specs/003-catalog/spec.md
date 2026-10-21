# 003 · Catálogo de problemas conocidos e incidentes

- **Estado:** Borrador
- **Prioridad:** Must (incidentes y artículo desde ticket: Should)
- **PDF:** §03
- **Depende de:** 001, 002
- **Habilita:** 004

## Problema

El asistente necesita una base de conocimiento mantenible y versionada para no
improvisar respuestas. El equipo necesita publicar, corregir y archivar soluciones,
y avisar de incidentes conocidos sin exponer casos de otros usuarios.

## Historias

- Como admin, quiero crear un artículo con todos sus campos, guardarlo como borrador,
  editarlo (cada edición es una versión nueva), publicarlo y archivarlo.
- Como admin, quiero buscar artículos por texto, categoría, estado y etiqueta.
- Como admin, quiero preparar un artículo a partir de un ticket resuelto, revisarlo y
  publicarlo sin arrastrar comentarios privados, adjuntos ni datos personales.
- Como admin, quiero registrar un incidente conocido y su estado para que el chat lo
  informe y vincule los tickets nuevos.
- Como solicitante, quiero abrir desde el chat el artículo usado y leer instrucciones
  claras.

## Criterios de aceptación

| ID | Criterio |
| --- | --- |
| AC-003.1 | Un artículo tiene: título, categoría, síntomas, plataforma o versión aplicable, pasos de diagnóstico, solución, condiciones de escalación, etiquetas, estado de publicación (`draft`, `published`, `archived`), fecha de revisión (`reviewed_at`), vigencia opcional (`valid_until`) y la marca `is_example` |
| AC-003.2 | Las versiones son inmutables. Editar crea `version + 1` como borrador. Publicar fija `published_version_id`. La versión publicada anterior sigue consultable (porque una conversación pudo usarla) |
| AC-003.3 | `GET /support/articles?q=&category=&tag=&status=` ordena por relevancia. El solicitante solo recibe artículos **publicados y vigentes**: no archivados y con `valid_until` nulo o futuro. El admin ve todos los estados |
| AC-003.4 | La búsqueda usa full-text en español sin acentos (`spanish` + `unaccent`) sobre título, síntomas, solución y etiquetas, con fallback por trigramas en el título para errores de tipeo. "contrasena" encuentra "contraseña" |
| AC-003.5 | Existen ≥ 10 artículos de ejemplo cargados por seed, que cubren acceso, permisos, funcionamiento de pantallas, carga de archivos y comportamiento inesperado. Todos con `is_example = true`, la etiqueta visible "Ejemplo — no es procedimiento oficial de PBG" y contenido ficticio |
| AC-003.6 | Los endpoints de escritura (`POST /support/articles`, `/versions`, `/publish`, `/archive`) solo están disponibles para admin; un no admin recibe 403. Cada uno valida `version` cuando corresponde |
| AC-003.7 | *(Should)* `POST /support/articles/from-ticket/:ticketId` solo acepta tickets `closed` con `closure_reason = resolved`. Crea un borrador prellenado con el título, la categoría, los síntomas (de `ai_summary`), los pasos intentados y la solución (`resolution_summary`). **No** copia comentarios, notas internas, adjuntos, nombres, correos ni el número del ticket. Se guarda `source_ticket_id` para trazabilidad interna. El admin revisa y publica a mano |
| AC-003.8 | *(Should)* Un incidente tiene título, resumen público, estado (`investigating`, `identified`, `monitoring`, `resolved`), categoría y artículo opcional. `GET /support/incidents?active=true` lo ve cualquier usuario y devuelve **solo** campos públicos. Los tickets vinculados no se exponen |
| AC-003.9 | *(Should)* Un ticket se puede vincular a un incidente (`incident_id`), lo que crea el evento `incident_linked`. El conteo de tickets afectados solo lo ve el admin |
| AC-003.10 | UI admin `/admin/catalogo`: lista con búsqueda y filtros; editor con vista previa; historial de versiones; acciones publicar, archivar y nueva versión; badge "Ejemplo"; aviso si `reviewed_at` tiene más de 90 días |
| AC-003.11 | UI de lectura `/soporte/articulos/:slug`: muestra la versión publicada (o una versión concreta con `?v=`), la marca de ejemplo, la fecha de revisión y el botón "Esto no me resolvió → volver al chat" |

## Fuera de alcance

- Búsqueda semántica con embeddings y pgvector. Se documenta como camino para escalar.
- Flujos de aprobación con varios revisores.
