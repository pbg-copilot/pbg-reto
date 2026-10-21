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
observada y las notas que se pudieron leer.

`activity` solo expone notas vinculadas a una llamada mediante `callId` y con
fecha verificable. Su paginación incluye el total de entradas verificables, de
modo que el estado no depende de la página de notas solicitada. Las cadenas de
`calls` no se interpretan como eventos porque
el respaldo no confirma su formato ni fechas; en ese caso la respuesta marca
la actividad como parcial o no disponible y explica la limitación.

## Errores

- `400 invalid_request`: cuerpo inválido o contenido vacío.
- `401 unauthorized`: falta una sesión válida, venció o la cuenta ya no está activa.
- `404 not_found`: conversación o cliente inexistente, ajeno o no verificable.
- `409 conversation_archived`: intento de agregar mensajes o cambiar el cliente de una conversación archivada.
- `500 internal_error`: fallo inesperado; no incluye campos de la conversación.

Las respuestas solo incluyen los campos proyectados del cliente autorizado. Las
cotizaciones y citas siguen inaccesibles porque sus relaciones con clientes no
están confirmadas por el modelo de datos local.
