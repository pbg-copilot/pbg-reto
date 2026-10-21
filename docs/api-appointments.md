# API de disponibilidad de agenda

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
