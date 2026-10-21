# ADR 0001 · Esquema `helpdesk` propio en lugar de reutilizar `support.*`

- **Estado:** Aceptada (2026-10-20)
- **Contexto del PDF:** §10, "Revisar primero el esquema existente de soporte para
  decidir qué reutilizar. Documentar la decisión y conservar la estructura y datos
  entregados."

## Contexto

La réplica incluye un esquema `support` con 21 tablas (`support_cases`,
`support_messages`, `support_recipes`, `support_issues`, `support_operators`…) y
datos reales: 76 casos, 265 mensajes y 8 recetas.

Al revisarlo:
- **Viene de SQLite.** Las fechas son `bigint` (epoch), el JSON se guarda como
  `text`, cada tabla tiene una columna `rowid` y casi no hay claves foráneas.
- **Modela otro flujo.** Son operadores internos con aprobaciones y acciones
  automáticas ("recipes" que ejecutan cambios). No es el ciclo de tickets del reto
  (Abierto → En revisión → Cerrado, comentarios públicos o internos, notificaciones).
- **Sus conteos están congelados.** `tests/database.test.mjs` compara los conteos y
  columnas de **todas** las tablas originales contra `data/manifest.json`. Escribir
  en `support.*` rompe ese test.
- **El contenido es real.** El PDF pide que la demo use contenido ficticio.

## Decisión

Crear un esquema nuevo, `helpdesk`, con migraciones propias (Kysely), tipos nativos
(`uuid`, `timestamptz`, `jsonb`), claves foráneas y restricciones de estado.

- **Identidad:** se reutilizan `onboarding.accounts` (claves foráneas a
  `accounts.id`) y la autenticación del repo base (`reto.sessions`, `reto.agents`).
- **Esquemas originales:** no se modifica ninguno. Solo se agregan las extensiones
  `unaccent` y `pg_trgm` en `public`, que no cambian tablas existentes.
- **Recetas de `support_recipes`:** no se copian al catálogo, porque son
  procedimientos reales. Sirven solo como inspiración para las categorías
  (acceso, restablecimiento de contraseña…).

## Consecuencias

- Los tests del repo base siguen verdes y los datos entregados quedan intactos.
- El historial de casos previo (`support.*`) no aparece en la nueva sección de
  tickets. Una migración de datos sería un trabajo aparte y requeriría anonimizar.
- Las tablas de control de Kysely (`kysely_migration`, `kysely_migration_lock`)
  viven en `helpdesk`, no en `public`.
