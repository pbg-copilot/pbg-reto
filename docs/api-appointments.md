# API de disponibilidad de agenda

## `GET /api/conversations/{conversationId}/appointments`

Devuelve citas confirmadas de Chat PBG asociadas a la conversación y al cliente
activo. La ruta vuelve a validar la conversación, el cliente y el alcance de cada
agente responsable; no usa el ID de cita como prueba de acceso. Requiere sesión y
un cliente seleccionado. Una conversación inexistente devuelve `404` y la falta
de cliente activo devuelve `409 client_not_selected`.

La interfaz usa este listado para permitir reprogramar o cancelar una cita. Solo
se presentan citas cuyo agente responsable sigue dentro del alcance del usuario.

## `GET /api/appointments/availability`

Consulta solapamientos con citas confirmadas del calendario propio de Chat PBG.
No consulta `teamops.bookings`, que pertenece a flujos internos de demo y
consultoría. La ruta no requiere un cliente porque en esta etapa solo responde
por el calendario del agente.

### Parámetros requeridos

- `agentAccountId`: cuenta del agente. Un agente solo puede consultar su propia
  cuenta; `agency_owner` solo agentes activos de su agencia actual; `admin`,
  cualquier agente activo.
- `localStart`: hora local sin offset, en formato `YYYY-MM-DDTHH:mm` o con
  segundos `YYYY-MM-DDTHH:mm:ss`.
- `durationMinutes`: entero entre 1 y 1440. La duración se suma al instante
  UTC resuelto, no al reloj local.
- `timeZone`: zona IANA, por ejemplo `America/Bogota`.
- `utcOffsetMinutes`: opcional. Se usa para elegir una de las instancias
  posibles cuando `localStart` es ambigua durante un cambio estacional; el
  offset debe coincidir con una de las opciones devueltas.

Ejemplo:

```http
GET /api/appointments/availability?agentAccountId=agent-id&localStart=2026-10-22T09%3A00&durationMinutes=30&timeZone=America%2FBogota
```

La respuesta incluye inicio/fin como instantes UTC y sus representaciones
locales con offset, el estado de disponibilidad y los intervalos confirmados que
se cruzan. Los intervalos son semiabiertos `[start_at, end_at)`, por lo que dos
citas contiguas no se consideran solapadas.

```json
{
  "agent_account_id": "agent-id",
  "availability_status": "no_conflict",
  "interval": {
    "start_at": "2026-10-22T14:00:00.000Z",
    "end_at": "2026-10-22T14:30:00.000Z",
    "duration_minutes": 30,
    "time_zone": "America/Bogota",
    "start_local": "2026-10-22T09:00:00-05:00",
    "end_local": "2026-10-22T09:30:00-05:00",
    "start_utc_offset_minutes": -300
  },
  "conflicts": [],
  "calendar_status": "loaded",
  "confirmed_appointment_count": 4,
  "availability_basis": "no_overlapping_confirmed_chat_appointments",
  "limitations": ["..."]
}
```

Se valida la zona con `Intl` y se comprueba la hora local mediante conversión de
ida y vuelta. Una hora inexistente devuelve `400 nonexistent_local_time`; una
hora repetida por cambio estacional devuelve `409 ambiguous_local_time` con los
instantes UTC posibles y su offset; el cliente puede reenviar el offset elegido
como `utcOffsetMinutes`. Se rechazan fechas locales inválidas y zonas que no
sean IANA. `calendar_status: empty` indica que aún no hay citas confirmadas en
el calendario del agente. `no_conflict` significa exclusivamente que no se
encontró solapamiento con citas confirmadas de Chat PBG; no afirma que el agente
esté disponible según horarios laborales, feriados o calendarios externos.

La disponibilidad significa que no hay otra cita **confirmada de Chat PBG** que
se cruce con el intervalo. No se han definido horarios laborales, feriados ni
bloqueos externos, por lo que la ruta informa esa limitación y no afirma que el
agente esté libre fuera de esas reglas. Las respuestas usan solo los IDs y
horarios de los conflictos; no incluyen datos del cliente.

### Errores

- `400 invalid_time_zone`, `invalid_local_datetime` o `nonexistent_local_time`:
  zona/fecha inválida u hora local inexistente.
- `401 unauthorized`: sesión inválida o vencida.
- `404 not_found`: agente inexistente, inactivo o fuera del alcance.
- `409 ambiguous_local_time`: hora repetida; la respuesta trae los instantes
  UTC posibles.

## Crear, reprogramar y cancelar

Las mutaciones requieren dos pasos en la misma conversación activa y con un
cliente seleccionado y autorizado. Los roles `agent` y `agency_owner` pueden
actuar dentro de su alcance; `admin` conserva lectura global, pero no muta la
agenda desde el chat.

### 1. Preparar la confirmación exacta

`POST /api/conversations/{conversationId}/appointments/confirm` acepta una
acción `create`, `reschedule` o `cancel`. Para crear se envían
`agentAccountId`, `localStart`, `durationMinutes` y `timeZone`. Para reprogramar
se envía `appointmentId` y el nuevo horario; el agente puede omitirse para
conservar el actual. Para cancelar basta `appointmentId`.

La API verifica sesión, conversación, cliente y alcance del agente y devuelve
una propuesta con ruta e ID del cliente, ID del agente, acción e intervalo
resuelto en UTC, zona IANA, hora local y offset. Esta operación no modifica la cita. La confirmación
vence en cinco minutos y queda ligada a esos valores. Si cambia el cliente, el
agente deja de estar autorizado o cambia la cita que se va a reprogramar o
cancelar, la propuesta queda obsoleta y se debe preparar otra.

### 2. Ejecutar la confirmación

`POST /api/conversations/{conversationId}/appointments` recibe
`confirmationId` y una `idempotencyKey` UUID. La API vuelve a validar permisos,
cliente, vigencia y estado de la cita, y aplica el cambio dentro de una
transacción. Reutilizar la misma clave en la misma conversación con la misma
confirmación devuelve el resultado original; usarla con otros datos o en otra
conversación devuelve `409 idempotency_key_reused`.

Una restricción de exclusión GiST de PostgreSQL impide intervalos superpuestos
para el mismo agente entre citas confirmadas, incluso con solicitudes
concurrentes. Ante el conflicto se revierte el cambio de cita, se invalida la
confirmación y se registra el resultado `slot_taken`; la respuesta es `409` y
no contiene una escritura parcial. El resultado exitoso registra actor, rol,
alcance, cita y resultado en `reto.chat_actions`; el snapshot mínimo permite
responder de forma idempotente.

Errores relevantes: `401 unauthorized`, `404 not_found`, `409
conversation_archived`, `client_not_selected`, `confirmation_expired`,
`confirmation_already_used`, `stale_confirmation`, `slot_taken` e
`idempotency_key_reused`. Los errores de validación de hora y zona se describen
en la sección de disponibilidad.
