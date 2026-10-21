# Modelo de datos verificado — fuentes para Chat PBG

**Verificado:** 20 de octubre de 2026, contra `data/manifest.json`, el esquema SQL incluido y los metadatos de la base local restaurada.  
**Alcance de la inspección:** nombres de tablas/columnas, tipos, constraints, índices, estructura y conteos. No se consultaron ni reprodujeron valores de expedientes personales.

## Resumen ejecutivo

La réplica conserva el esquema original. Hay tres dominios que no se deben confundir:

1. **Leads/libros de clientes:** documentos JSON flexibles en `public.pbg_state_documents`, con rutas bajo `leads-store/books/`.
2. **Cotizaciones analíticas:** filas de `analytics.quotes`, agregadas por campos de cuenta/agencia/lead, sin claves foráneas que prueben relación con un libro de cliente.
3. **Bookings internos de equipo/demos:** filas de `teamops.bookings`, con leads internos en `teamops.leads`; no se ha demostrado que sean citas de seguros de un cliente y agente.

En consecuencia, antes de implementar consultas del chat no se debe unir un `lead_id` de analítica con el `id` de un objeto JSON, ni exponer un booking de `teamops` como cita del expediente, sin una regla de correspondencia validada.

## Procedencia y estado de la copia

- El manifiesto identifica el respaldo como PostgreSQL de AWS con fecha de corte `2026-10-20T15:01:25+00:00`.
- La copia contiene 182 tablas, 351.429 filas en origen y 350.217 distribuidas; las exclusiones están descritas en el manifiesto y README.
- Conteos observados en esta réplica: `onboarding.accounts` 107, `onboarding.agencies` 5, `onboarding.profiles` 105, `onboarding.agency_team_leads` 12, `analytics.quotes` 870, `teamops.leads` 364, `teamops.bookings` 358, `public.pbg_state_documents` 28.879, `public.pbg_state_appends` 1.501 y `public.pbg_state_media` 35.918.
- Roles agregados comprobados en `onboarding.accounts`: `agent` 97, `agency_owner` 4, `admin` 5 y `appeal_officer` 1. Coinciden con los roles de cuentas de prueba descritos en README para `agente099`, `agente016`, `agente067` y `agente009`, respectivamente.
- Los conteos describen este snapshot, no datos en vivo. La aplicación del reto no se conecta a producción.

## Agentes y agencias

### Tablas y relaciones confirmadas

| Tabla | Campos relevantes | Relaciones y constraints declaradas |
| --- | --- | --- |
| `onboarding.accounts` | `id`, `role`, `status`, `agency_id`, `seat_role`, `setter_for_account_id` | PK `id`; FK `agency_id → onboarding.agencies.id`; `email` único. También tiene datos de autenticación/facturación que no deben incluirse en respuestas del chat. |
| `onboarding.agencies` | `id`, `owner_account_id`, `name`, `status`, `timezone` | PK `id`; FK `owner_account_id → onboarding.accounts.id`. |
| `onboarding.profiles` | `account_id`, nombre, idioma, datos profesionales y datos de contacto | PK `account_id`; FK `account_id → onboarding.accounts.id`. Incluye campos personales y sensibles; seleccionar solo lo estrictamente necesario. |
| `onboarding.agency_team_leads` | `agency_id`, `leader_account_id`, `member_account_id`, `removed_at`, `removed_by` | PK compuesta (`agency_id`, `leader_account_id`, `member_account_id`). El esquema inspeccionado no declara FKs para estas tres columnas. `removed_at` señala relación retirada. |

Relaciones seguras que sí están respaldadas por constraints:

```text
onboarding.accounts.agency_id → onboarding.agencies.id
onboarding.agencies.owner_account_id → onboarding.accounts.id
onboarding.profiles.account_id → onboarding.accounts.id
```

`accounts.role` y `accounts.agency_id` son parte del modelo original. La réplica además conserva equipos y asignaciones auxiliares; la autorización debe aplicar una política explícita a esas relaciones y validar las relaciones retiradas. Los nombres de roles por sí solos no definen el alcance funcional completo.

## Expedientes / libros de leads

### Estructura observada

`public.pbg_state_documents` tiene:

- `path text` como clave primaria;
- `content text` como representación textual;
- `document jsonb` como representación estructurada cuando está disponible;
- `mode` y `modified_at`.

Hay 65 rutas con prefijo `leads-store/books/`; 62 tienen `document.leads` como arreglo. El objeto JSON observado tiene campos superiores `leads` y `ownerKey`. Los elementos del arreglo son objetos con un vocabulario de campos variable; entre los nombres observados están `id`, `name`, `phone`, `email`, `notes`, `stage`, `source`, `attribution`, `formAnswers`, `calls`, `sale`, `coverageSet` y `premiumSet`. La presencia de una clave no garantiza que exista en todos los elementos ni define por sí sola su significado.

`public.pbg_state_appends` almacena `sequence`, `path`, `content` y `created_at`; tiene FK `path → public.pbg_state_documents.path` con borrado/actualización en cascada. Puede aportar historial de cambios de documento, pero su contenido no está normalizado en columnas de negocio.

`public.pbg_state_media` conserva rutas y metadatos (`object_key`, `sha256`, tamaño y fecha); no contiene los objetos binarios externos.

### Implicaciones para consultas y procedencia

- Tratar cada libro como documento JSON flexible; validar en backend la forma del JSON antes de leer campos opcionales.
- Usar `path` como referencia durable del documento. Para un elemento, conservar además su `id` observado y validar que siga en el documento cargado.
- No asumir una FK relacional entre el `ownerKey` JSON y una cuenta. La relación requiere confirmar formato y política de ownership con datos estructurales adicionales.
- No devolver el documento completo: contiene datos personales. Proyectar una lista permitida de campos por caso de uso y rol.
- Para notas o actividad, distinguir contenido actual del documento de entradas append-only y conservar su ruta/orden/fecha como procedencia.
- Las rutas de medios no dan acceso a los binarios de S3/R2.

## Cotizaciones

`analytics.quotes` contiene 870 filas en el snapshot y los campos:

`quote_id`, `session_id`, `attempt_id`, `account_id`, `agency_key`, `lead_id`, `carrier`, `product`, `face_amount_cents`, `monthly_premium_cents`, `annual_premium_cents`, `derived`, `created_at`, `created_epoch`, `day_et`, `hour_et`, `minute_of_day_et`, `collected_at`.

- `quote_id` es PK.
- Hay índices por `account_id/day_et`, `carrier/day_et` y `day_et`.
- `account_id`, `agency_key` y `lead_id` son texto, sin FKs declaradas en esta tabla.
- Los importes están expresados en centavos; `derived` requiere confirmar semántica antes de interpretarlo.
- Es un conjunto de analítica/telemetría de cotización; el esquema no expone condiciones completas, coberturas ofertadas ni reglas de suscripción.

**Uso permitido en el MVP:** no presentar estas filas como cotizaciones del cliente hasta confirmar qué sistema las produjo, qué significa cada ID y cómo se relaciona `lead_id` con los libros. No usar valores de prima como precio vigente ni como cotización aprobada.

## Agenda y bookings

### `teamops.bookings`

Hay 358 filas. Campos estructurales relevantes: `id`, `source`, `meeting_type`, `duration_minutes`, datos del visitante, `start_utc`, `end_utc`, `visitor_timezone`, `host_timezone`, `status`, marcas de cancelación/borrado, `host_id`, `booked_by`, `kind` y `rowid`.

- PK `id`; `rowid` único; `duration_minutes > 0`.
- `status` solo admite `confirmed` o `cancelled`; `source` está restringido a categorías internas de consulting/demo/onboarding/support.
- `cancelled_by_user_id` refiere a `teamops.users.id`. No hay FK declarada para `host_id`.
- Un índice único parcial impide un segundo booking confirmado/no borrado para el mismo `host_id` y `start_utc`. Solo evita el mismo instante de inicio; no impide por sí solo intervalos que se solapan.
- `start_utc`/`end_utc` son texto, no `timestamptz`.

`teamops.leads` tiene 364 filas y campos internos de seguimiento (`stage`, `notes`, `next_action`, `next_action_due`, `deleted_at`, etc.). `booking_id` tiene FK a `teamops.bookings.id`; hay unicidad parcial de `booking_id` para registros no borrados. Sus etapas incluyen gestión de demo/propuesta/onboarding y no prueban que sean clientes de seguros.

**Conclusión:** estos datos representan bookings de los flujos internos que permite `source`; no son base suficiente para agendar una cita de seguros de un expediente. No reutilizar la restricción o estos endpoints para la agenda del reto sin confirmar producto, ownership y política de calendario.

## Reglas de opciones / suscripción

En las tablas y metadatos inspeccionados no se identificó un catálogo versionado de productos, reglas de elegibilidad, tarifas o coberturas. `analytics.quotes` registra ciertos campos de resultado y contexto, pero no define cómo calcularlos ni si son vigentes/aprobados. Esta es una observación del esquema restaurado, no una afirmación de que no exista documentación externa.

Hasta recibir reglas documentadas con versión y responsable:

- resumir solo datos almacenados con fuente;
- describir cotizaciones como registros analíticos cuya relación/semántica debe confirmarse;
- enumerar información faltante;
- no recomendar una opción ni inferir aprobación, cobertura o precio vigente.

## Consultas seguras para inspección

Ejemplos de metadatos, sin seleccionar contenido personal:

```sql
-- Relaciones principales de cuentas y agencias.
SELECT a.id, a.role, a.agency_id, g.owner_account_id
FROM onboarding.accounts AS a
LEFT JOIN onboarding.agencies AS g ON g.id = a.agency_id;

-- Estructura de libros, no contenido.
SELECT count(*) AS book_documents,
       count(*) FILTER (WHERE jsonb_typeof(document->'leads') = 'array') AS books_with_leads_array
FROM public.pbg_state_documents
WHERE path LIKE 'leads-store/books/%';

-- Volúmenes y estados, no PII.
SELECT count(*) FROM analytics.quotes;
SELECT status, count(*) FROM teamops.bookings GROUP BY status;
```

No pegar resultados que incluyan `document`, `content`, nombres, teléfonos, emails, notas, primas u otros valores personales en tickets o documentación pública.

## Decisiones y preguntas pendientes

1. Confirmar formalmente si `leads-store/books` representa clientes activos de seguros y definir `ownerKey`/reasignaciones.
2. Definir el enlace válido entre libros y `analytics.quotes`, o confirmar que no hay enlace utilizable.
3. Identificar la fuente aprobada de citas del agente para seguros; la tabla de teamops no satisface ese requisito según su `source` y modelo actuales.
4. Confirmar reglas de recomendación, precios, cobertura y aprobación fuera de la estructura de datos.
5. Definir proyección de campos por rol y política de retención de mensajes/evidencia, minimizando datos personales.
