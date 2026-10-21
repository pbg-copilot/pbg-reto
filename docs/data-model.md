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

Las notas observadas son arreglos de objetos con texto (`text`, a veces bilingüe),
`at` numérico o textual, y ocasionalmente `id` y `callId`. El endpoint de perfil
solo convierte `at` numérico dentro de un rango válido en fecha y conserva la
referencia a la ruta, cliente y nota. Las cadenas en `calls` carecen de una
estructura confirmada para identificar y fechar eventos; no se presentan como
actividad verificable. Las notas asociadas con `callId` se muestran como
actividad parcial solo si también tienen una fecha verificable.

### Vínculo implementado para búsqueda del chat

La inspección estructural local de la copia pudo decodificar 62 documentos de
libro; en los 62, `ownerKey` coincide exactamente con un `onboarding.accounts.id`.
La búsqueda del chat usa esa igualdad exacta como vínculo de propiedad y exige
que la cuenta propietaria esté activa. Los documentos/registros que no se puedan
resolver mediante esa relación se omiten y no se pueden seleccionar. La regla
se aplica así: `agent` solo consulta su propia cuenta; `agency_owner` consulta
cuentas activas cuyo `agency_id` actual coincide con el suyo; `admin` puede leer
los libros enlazados. No se usan coincidencias de nombre, correo o alias.

`public.pbg_state_appends` almacena `sequence`, `path`, `content` y `created_at`; tiene FK `path → public.pbg_state_documents.path` con borrado/actualización en cascada. Puede aportar historial de cambios de documento, pero su contenido no está normalizado en columnas de negocio.

`public.pbg_state_media` conserva rutas y metadatos (`object_key`, `sha256`, tamaño y fecha); no contiene los objetos binarios externos.

### Implicaciones para consultas y procedencia

- Tratar cada libro como documento JSON flexible; validar en backend la forma del JSON antes de leer campos opcionales.
- Usar `path` como referencia durable del documento. Para un elemento, conservar además su `id` observado y validar que siga en el documento cargado.
- `ownerKey` sigue siendo un campo JSON sin FK; la API aplica el vínculo exacto descrito arriba y falla cerrada cuando no encuentra una cuenta activa.
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

**Decisión de dominio para el MVP:** interpretar cada fila únicamente como una instantánea analítica de valores registrados, asociada técnicamente a un lead cuando `lead_id` coincide exactamente con el ID del lead del libro activo y `account_id` coincide exactamente con su propietario activo. La API también aplica el alcance de agente/agencia de la sesión. La respuesta usa `analytics_snapshot` y `exact_key_match_association_only`; no llama a la fila oferta emitida, vigente o aprobada. La ruta omite filas con propietario no resoluble, ID de cliente duplicado en el libro o cuenta fuera del alcance. No usa `derived` ni otros campos internos.

Significado de campos en esta API: `carrier` y `product` son etiquetas tal como se almacenaron; `face_amount_cents` es el valor nominal registrado, no cobertura contratada; los importes mensual/anual son valores almacenados, no tarifas vigentes; `created_at` es fecha de registro analítico, no fecha de emisión o vigencia. La comparación es lado a lado de valores existentes, no una clasificación ni recomendación. El enlace exacto es una convención prudente del MVP, no una FK declarada ni garantía de validez comercial.

## Agenda y bookings

### Calendario de Chat PBG: `reto.chat_appointments`

La migración `002_chat_appointments` crea la fuente de citas del reto, separada
de `teamops.bookings`. Conserva agente, conversación, cliente opcional, intervalo
absoluto (`start_at`/`end_at` como `timestamptz`), zona IANA, hora local original,
offset resuelto y estado. La API de disponibilidad consulta los intervalos
confirmados de esta tabla. La migración `003_appointment_confirmation_and_overlap`
añade `reto.chat_appointment_confirmations`, que guarda por cinco minutos la
propuesta exacta de crear, reprogramar o cancelar antes de modificar una cita.
Cada cita conserva la última confirmación aplicada. La misma migración instala
una restricción de exclusión GiST que impide solapamientos activos por agente.
La operación y su resultado mínimo se guardan en `reto.chat_actions`, junto con
actor, alcance, clave idempotente y snapshot de respuesta.

La consulta calcula conflictos con intervalos semiabiertos `[inicio, fin)` y no
impone todavía una política de horario laboral, feriados o bloqueos externos.
No se reutilizan bookings históricos del equipo como agenda de seguros.

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
- describir filas devueltas por la API como instantáneas analíticas asociadas por coincidencia exacta de IDs;
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

1. Confirmar con el propietario del dominio si `leads-store/books` representa clientes activos de seguros y si la regla de propiedad por `ownerKey` debe cubrir transferencias históricas; la API solo aplica la cuenta/agencia actual.
2. Si se requiere presentar las instantáneas como ofertas comerciales, obtener una fuente documental que defina estados de emisión, vigencia y aprobación; el MVP no depende de esa interpretación.
3. Identificar la fuente aprobada de citas del agente para seguros; la tabla de teamops no satisface ese requisito según su `source` y modelo actuales.
4. Confirmar reglas de recomendación, precios, cobertura y aprobación fuera de la estructura de datos.
5. Definir proyección de campos por rol y política de retención de mensajes/evidencia, minimizando datos personales.
