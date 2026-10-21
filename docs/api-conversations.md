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

## Errores

- `400 invalid_request`: cuerpo inválido o contenido vacío.
- `401 unauthorized`: falta una sesión válida, venció o la cuenta ya no está activa.
- `404 not_found`: conversación inexistente, ajena o con relaciones/evidencia no verificables.
- `409 conversation_archived`: intento de agregar mensaje a una conversación archivada.
- `500 internal_error`: fallo inesperado; no incluye campos de la conversación.

Las respuestas no contienen filas de clientes, cotizaciones o citas. Esas
relaciones aún no están confirmadas por el modelo de datos local.
