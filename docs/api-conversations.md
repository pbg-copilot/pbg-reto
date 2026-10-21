# API de conversaciones

Rutas disponibles en la API local. Requieren `Authorization: Bearer <token>` o
la cookie HttpOnly `reto_session`, excepto donde se indique lo contrario. La
cuenta, el rol y el propietario se obtienen de la sesión; los cuerpos no pueden
asignarlos.

## `POST /api/conversations`

Crea una conversación para la cuenta autenticada. El backend asigna el
propietario y genera el UUID.

Request:

```json
{ "title": "Seguimiento" }
```

`title` es opcional (máximo 200 caracteres). Una cadena vacía tras recortarla
se guarda como `null`. No se aceptan propiedades adicionales.

Response `201`:

```json
{
  "conversation": {
    "id": "uuid",
    "owner_account_id": "account-id",
    "title": "Seguimiento",
    "status": "active",
    "active_client_path": null,
    "active_client_record_id": null,
    "created_at": "timestamp",
    "updated_at": "timestamp",
    "archived_at": null
  }
}
```

La creación vuelve a validar la sesión dentro de la transacción que inserta la
fila.

## `GET /api/conversations`

Devuelve las conversaciones que pertenecen a la cuenta autenticada, ordenadas
por `updated_at` descendente y luego por `id` ascendente:

```json
{ "conversations": [] }
```

Cada elemento usa el objeto `conversation` descrito en la respuesta de creación.

Se omiten conversaciones cuyo cliente o evidencia vinculada no pueda validarse
con el snapshot actual.

## `GET /api/clients?q=ana&limit=20`

Busca clientes en los libros `leads-store/books`. `q` es obligatorio, admite de
2 a 100 caracteres y busca parcialmente por nombre, correo, teléfono o ID del
registro. `limit` es opcional (por defecto 20, máximo 50). Los resultados solo
incluyen documentos cuyo `ownerKey` coincide exactamente con una cuenta activa
y cuyo alcance corresponde a la sesión: la cuenta propia para `agent`, la
agencia actual para `agency_owner`, y lectura global para `admin`. Documentos,
propietarios o registros que no puedan validarse se omiten.

```json
{
  "clients": [
    {
      "document_path": "leads-store/books/...",
      "client_record_id": "record-id",
      "name": "Nombre",
      "email": "persona@example.test",
      "phone": "+999...",
      "stage": "..."
    }
  ]
}
```

## `POST /api/conversations/:conversationId/client`

Selecciona un cliente permitido para la conversación o lo cambia:

```json
{
  "documentPath": "leads-store/books/...",
  "clientRecordId": "record-id"
}
```

El backend vuelve a resolver la sesión, bloquea la conversación del usuario y
comprueba documento, `ownerKey`, cuenta activa y registro dentro de la misma
transacción. Un ID ajeno, inexistente o no verificable devuelve un `404` genérico.
Conversaciones archivadas devuelven `409`. La respuesta incluye el cliente
seleccionado y `changed`; repetir la selección actual devuelve `changed: false`.
Cada selección o cambio efectivo actualiza el cliente activo y crea una fila en
`reto.chat_actions` (`client.selected` o `client.changed`) en la misma
transacción. Cambiar cliente reemplaza el contexto activo; las respuestas
posteriores validan nuevamente el acceso antes de recuperar la conversación.

## `GET /api/conversations/:conversationId?limit=50&beforeSequence=123`

Devuelve la conversación y sus mensajes. El acceso se filtra por propietario en
SQL y se vuelve a validar dentro de una transacción que bloquea la fila. Un ID
inexistente, ajeno o con cliente/evidencia no verificable da el mismo `404`.

```json
{
  "conversation": { /* objeto conversation */ },
  "messages": [
    {
      "id": "uuid",
      "sequence_no": "1",
      "sender_role": "user",
      "content": "Mensaje del agente",
      "created_at": "timestamp"
    }
  ],
  "pagination": {
    "limit": 50,
    "hasMore": true,
    "nextBeforeSequence": "51"
  }
}
```

La primera página contiene los mensajes más recientes; dentro de cada respuesta
se ordenan por `sequence_no` ascendente. `limit` es opcional (por defecto 50,
rango 1–100). `sequence_no` se entrega como cadena para conservar el entero de
PostgreSQL. Cuando `hasMore` es `true`, usa `nextBeforeSequence` como
`beforeSequence` para solicitar la página anterior, sin incluir el mensaje del
cursor. El historial omite mensajes con referencias de cliente o evidencia
hasta que exista una relación de ownership verificable.

## `POST /api/conversations/:conversationId/messages`

Guarda un mensaje de usuario en una conversación activa:

```json
{ "content": "Mensaje del agente" }
```

`content` debe contener texto no vacío (máximo 12.000 caracteres). No se acepta
`sender_role`, propietario, referencias de cliente ni campos adicionales: el
servidor asigna el emisor `user` y deja las referencias vacías.

Response `201`:

```json
{
  "message": {
    "id": "uuid",
    "sequence_no": "2",
    "sender_role": "user",
    "content": "Mensaje del agente",
    "created_at": "timestamp"
  }
}
```

La sesión y la propiedad se revalidan dentro de una transacción. La fila de
conversación se bloquea mientras se inserta el mensaje y se actualiza
`updated_at`; si falla la operación, ambas escrituras se revierten. No se
admiten mensajes en conversaciones archivadas (`409`).

## `GET /api/assistant/status`

Indica si la integración opcional está habilitada para la sesión autenticada.
No entrega la URL ni la clave del proveedor. El asistente se habilita solo si
`LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` y
`LLM_EXTERNAL_DATA_AUTHORIZED=true` están configurados. El valor predeterminado
es deshabilitado.

## `POST /api/conversations/:conversationId/assistant`

Recibe `{ "content": "..." }` (máximo 4.000 caracteres). Revalida dentro de
PostgreSQL la sesión, propiedad de conversación, cliente activo y alcance. El
backend obtiene el perfil autorizado (`name`, `email`, `phone`, `stage`, ruta e
ID de registro) y hasta 50 cotizaciones asociadas por coincidencia exacta de
cliente/cuenta (`carrier`, `product`, importes registrados, fecha e ID de
fuente). Envía al proveedor solo esos campos, las limitaciones/faltantes
derivados por el backend y la pregunta del usuario. No envía notas, citas,
datos de otros clientes, credenciales ni historial; no pasa herramientas ni
acceso al repositorio/base de datos al modelo. El prompt le limita a redactar
evidencia y faltantes; el backend agrega a la respuesta los IDs de las fuentes
consultadas.

Antes de enviar los datos al proveedor, el backend vuelve a validar sesión,
alcance y cliente activo, y usa la evidencia de esa lectura. Luego valida otra
vez el contexto antes de persistir. Si cambia el cliente, se rechaza la
respuesta. Un proveedor deshabilitado devuelve `503 assistant_unavailable`; una
falla o respuesta inválida devuelve `502 assistant_provider_error` y no guarda
ninguno de los dos mensajes. El endpoint limita a 10 solicitudes por minuto.
El modelo no ejecuta acciones de negocio ni produce decisiones comerciales.

La autorización de transmisión de datos personales es una configuración de
despliegue explícita (`LLM_EXTERNAL_DATA_AUTHORIZED=true`), que requiere
aprobación específica del responsable de datos. La aplicación no activa ni
presupone ese consentimiento. El modo predeterminado es determinista y no hace
llamadas externas.

## `GET /api/conversations/:conversationId/client`

Devuelve el perfil proyectado del cliente activo en la conversación, notas con
texto verificable y referencias a su documento, ID y fecha. No acepta un ID de
cliente en la consulta: el backend usa la selección activa y vuelve a validar
su alcance. Si no hay cliente activo responde `409 client_not_selected`; si el
cliente ya no es accesible responde `404 not_found`.

Parámetros opcionales: `limit` (1–50, predeterminado 20) y
`beforeNoteIndex` (cursor de notas) y `beforeActivityIndex` (cursor independiente
de actividad). Cada lista se pagina por separado y se devuelve en orden
cronológico dentro de su página. `source` de cada elemento incluye el ID
del cliente, ruta del documento, ID/índice de nota y fecha derivada de `at`
cuando es un timestamp numérico válido. Se exponen las claves confirmadas
`name`, `email`, `phone` y `stage`; `missing` enumera campos ausentes.
`notes_status` indica `loaded`, `empty` o `unavailable` según la estructura
observada y la página solicitada: una página sin filas es `empty`, incluso si
el cursor llegó al final; `unavailable` indica que hay notas pero no se pudo
leer ninguna con texto verificable.

`activity` solo expone notas vinculadas a una llamada mediante `callId` y con
fecha verificable. Su paginación incluye el total de entradas verificables, de
modo que el estado no depende de la página de notas solicitada. Las cadenas de
`calls` no se interpretan como eventos porque
el respaldo no confirma su formato ni fechas; en ese caso la respuesta marca
la actividad como parcial o no disponible y explica la limitación.

## `GET /api/conversations/:conversationId/quotes`

Consulta registros analíticos para el cliente activo. La ruta revalida la
sesión, la propiedad de la conversación y el acceso al cliente activo. Solo
incluye filas cuando `analytics.quotes.lead_id` coincide exactamente con el ID
del cliente y `analytics.quotes.account_id` con la cuenta propietaria activa del
libro. La consulta conserva el alcance del agente, dueño de agencia o
administrador; no busca por nombre ni mezcla cuentas. La coincidencia exacta es
la asociación que adopta este MVP: una instantánea analítica vinculada por IDs,
no una oferta emitida. Esta convención permite consultar los datos sin atribuir
al respaldo significado comercial que no contiene.

```json
{
  "client_record_id": "record-id",
  "quotes_status": "loaded",
  "quotes": [{
    "id": "quote-id",
    "carrier": "...",
    "product": "...",
    "face_amount_cents": "...",
    "monthly_premium_cents": "...",
    "annual_premium_cents": "...",
    "recorded_at": "...",
    "source": {
      "type": "analytics_quote_snapshot",
      "table": "analytics.quotes",
      "record_id": "quote-id",
      "client_record_id": "record-id",
      "date": "...",
      "match_basis": "exact_lead_id_and_owner_account_id"
    }
  }],
  "comparison_status": "observed_fields_only",
  "comparison": {
    "quote_ids": ["quote-id"],
    "records": [{
      "quote_id": "quote-id",
      "carrier": "...",
      "product": "...",
      "face_amount_cents": "...",
      "monthly_premium_cents": "...",
      "annual_premium_cents": "...",
      "recorded_at": "...",
      "source_record_id": "quote-id"
    }],
    "fields": ["carrier", "product", "face_amount_cents", "monthly_premium_cents", "annual_premium_cents", "recorded_at"],
    "interpretation": "stored_values_only"
  },
  "rules": { "status": "unavailable", "version": null, "reason": "..." },
  "record_semantics": {
    "kind": "analytics_snapshot",
    "meaning": "Valores analíticos asociados por IDs exactos; no son oferta vigente, aprobada o emitida.",
    "fields": {
      "face_amount_cents": "Valor nominal almacenado; no confirma cobertura contratada.",
      "monthly_premium_cents": "Importe mensual almacenado; no confirma tarifa vigente.",
      "annual_premium_cents": "Importe anual almacenado; no confirma tarifa vigente.",
      "recorded_at": "Fecha de registro analítico; no es fecha de emisión o vigencia."
    }
  },
  "source": {
    "table": "analytics.quotes",
    "relationship_status": "exact_key_match_association_only"
  },
  "missing": ["..."]
}
```

Con varias filas, `comparison_status` es `observed_fields_only`; con una es
`single_record` y sin coincidencias es `empty` (`quotes_status: empty`). La
respuesta enumera reglas, vigencia y aprobación que no constan. La decisión del
MVP es tratar cada fila como instantánea analítica asociada por IDs exactos;
esta decisión no confirma la validez comercial de las filas. Solo proyecta los
campos mostrados; no expone identificadores internos de sesión/intento ni
`derived`. No interpreta primas como precios vigentes ni infiere coberturas,
elegibilidad o aprobación. Si la conversación no tiene cliente activo responde
`409 client_not_selected`; una conversación ajena o un cliente que ya no se
puede autorizar devuelve `404 not_found`.

## Errores

- `400 invalid_request`: cuerpo inválido o contenido vacío.
- `401 unauthorized`: falta una sesión válida, venció o la cuenta ya no está activa.
- `404 not_found`: conversación o cliente inexistente, ajeno o no verificable.
- `409 client_not_selected`: la consulta de perfil o cotizaciones requiere cliente activo.
- `409 conversation_archived`: intento de agregar mensajes o cambiar el cliente de una conversación archivada.
- `500 internal_error`: fallo inesperado; no incluye campos de la conversación.

Las respuestas solo incluyen los campos proyectados del cliente autorizado.
La ruta de cotizaciones devuelve únicamente coincidencias exactas de ID de
cliente y cuenta propietaria, marcadas como instantáneas analíticas. No hay
fuente confirmada de citas de seguros.
