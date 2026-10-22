# Demo reproducible — PBG-14

Esta guía demuestra el flujo local de Chat PBG y permite contrastar sus escrituras en PostgreSQL. Usa solo la réplica local; no conectes la demo a producción. La base conserva datos personales: mantén interfaz, terminal y capturas en el entorno autorizado, y oculta los valores personales antes de compartir evidencia.

## Preparación

Desde la raíz del repositorio, en PowerShell:

```powershell
docker compose up -d --build
docker compose ps
Invoke-RestMethod http://localhost:8008/health
```

Continúa cuando PostgreSQL y el backend estén `healthy` y `/health` responda `status: ok` y `database: ok`. Abre [http://localhost:8088](http://localhost:8088).

Cuenta principal:

- Usuario: `agente099@reto.example` (también acepta `agente099`)
- Contraseña local: `123456`
- Rol: `agent`

La interfaz permite consultar perfil y cotizaciones sin proveedor de IA. Para redacción, el botón se habilita solo si `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` y `LLM_EXTERNAL_DATA_AUTHORIZED=true` están activos en el backend. Esa autorización permite enviar al proveedor los campos limitados descritos en [api-conversations.md](./api-conversations.md); no la habilites para una demo sin autorización.

Después del login se muestra Home. Abre el modal con **Abrir Chat PBG** o el botón **Chat PBG** de la esquina inferior derecha. En el modal, las conversaciones están a la izquierda y **Cliente activo** y **Buscar cliente**, a la derecha. El panel derecho aparece después de crear o seleccionar una conversación. El submenú contiene **Home**, **Chat PBG**, **Consultas** y, para el agente, **Agenda**. **Home**, la X y Escape cierran el modal; al abrirlo de nuevo se conservan el módulo, la conversación, el tamaño y la posición durante esa sesión de página.

La ventana puede moverse desde la cabecera y redimensionarse desde la esquina inferior derecha. **Restablecer ventana** recupera la geometría inicial. Los paneles se apilan cuando el ancho es reducido.

## Recorrido de demostración

### 1. Conversación, expediente y cotizaciones

1. Inicia sesión, abre **Chat PBG** y pulsa el botón **+**, identificado como **Nueva conversación**, encima de la lista izquierda. Puedes renombrarla con el lápiz, escribir un título y pulsar ✓.
2. En **Buscar cliente**, escribe al menos dos caracteres y selecciona un resultado permitido. La interfaz muestra el nombre del cliente activo, pero oculta sus IDs y rutas internas. Para contrastar SQL, obtén los identificadores desde las respuestas de API en la pestaña **Network** o consultando la base local.
3. Abre **Consultas** y selecciona **Expediente**. El resultado ocupa el centro y las opciones de consulta pasan al lado izquierdo. Selecciona **Cotizaciones** para compararlas. La interfaz muestra los datos y faltantes sin exponer IDs ni fuentes internas. Las cotizaciones se describen como instantáneas analíticas, no como ofertas vigentes, aprobadas o emitidas.
4. Junto al cliente activo pulsa **Su ficha** para ver perfil, notas, cotizaciones, próxima cita y datos faltantes. La flecha **Volver al chat** regresa a la conversación.
5. En **Chat PBG**, si la IA está habilitada, pregunta: “Resume los datos disponibles y enumera qué falta para evaluar las cotizaciones”. Pulsa Enter para enviar; Shift+Enter inserta una línea. La respuesta resume la evidencia sin mostrar IDs ni fuentes internas. Si la IA está deshabilitada, las consultas y la agenda deterministas siguen disponibles.
6. Cierra y abre el modal: conserva el módulo y la conversación. Recarga la página, abre el modal y selecciona de nuevo la conversación: deben recuperarse su cliente e historial, situado en el último mensaje. Cambia de cliente y comprueba que sus mensajes están separados; vuelve al cliente anterior para recuperar su historial.
7. En la búsqueda izquierda escribe parte del título, del nombre del cliente o de un mensaje. Deben aparecer solo conversaciones propias que coincidan. Limpia el filtro para volver al listado.

### 2. Cita creada mediante el chat

1. Selecciona un cliente como contexto y escribe **Agendar cita** en el chat.
2. Envía una fecha futura y hora local en formato `AAAA-MM-DD HH:mm` o `DD/MM/AAAA HH:mm`, seguida, si deseas, de `, 45 minutos`. Para obtener una fecha futura de ejemplo ejecuta `(Get-Date).AddDays(7).ToString('dd/MM/yyyy')` y añade `15:00`. Si no indicas duración, se usan 30 minutos; la zona predeterminada es `America/Bogota`.
3. Revisa el mensaje de confirmación con cliente, agente, fecha, hora, duración y zona. Responde **Confirmar** para guardar, o **Cancelar** para descartar.
4. Confirma en el panel de agenda y en las tablas SQL que la cita quedó guardada como `confirmed` y que existe su acción de auditoría.
5. Pregunta en el chat **Lista las citas del cliente**. Debe mostrar las citas confirmadas del cliente activo con fecha, duración y zona horaria, sin requerir que la IA externa esté habilitada.

Antes de confirmar, también puedes recargar la página y volver a abrir la conversación: se recupera la propuesta pendiente mientras siga vigente. El listado de citas pertenece al cliente, por lo que otra conversación propia con ese cliente también muestra la cita.

### 3. Cita confirmada desde el panel

1. En el submenú **Agenda**, elige **Nueva cita**. Selecciona fecha futura, hora y duración. El formulario usa la zona `America/Bogota`.
2. Pulsa **Revisar cita** y comprueba cliente, inicio, fin, zona y offset. El agente es la cuenta autenticada para este recorrido; su ID aparece en la respuesta de confirmación de Network.
3. Pulsa **Confirmar operación**. La interfaz muestra **Cita creada**, fecha y zona; el ID técnico se consulta en Network o PostgreSQL.
4. Ejecuta las consultas SQL de abajo: la cita debe estar en `reto.chat_appointments` con estado `confirmed`, y la acción debe aparecer en `reto.chat_actions`.

La confirmación vence en cinco minutos. Si cambia un valor, prepara otra.

En el listado puedes usar **Reprogramar** o **Cancelar** y revisar y confirmar la operación. La creación por chat se ofrece al rol agente. El dueño conserva el alcance de las operaciones API documentadas; el administrador tiene lectura de expedientes y disponibilidad, sin mutaciones de agenda. Las conversaciones e historiales siguen siendo privados del usuario en todos los roles.

### 4. Idempotencia y conflicto

**Replay idempotente:** en las herramientas de desarrollador del navegador, pestaña **Network**, localiza el `POST /api/conversations/{conversationId}/appointments` exitoso. Reenvía exactamente la misma solicitud, con el mismo `confirmationId` y `idempotencyKey` (por ejemplo, **Edit and resend**). Debe devolver el mismo ID y `idempotent_replay: true`; no debe aparecer otra cita ni otra acción de escritura para esa clave. No cambies esos valores.

**Conflicto:** en la misma conversación y para el mismo agente, prepara otra cita para el mismo intervalo confirmado. Confirma la propuesta nueva. Debe recibirse `409 slot_taken`, mostrarse un conflicto controlado y conservarse la cita original sin una segunda fila confirmada. La propuesta nueva no reutiliza la confirmación ni la clave anteriores.

En `reto.chat_actions`, creación: `outcome = 'succeeded'`; conflicto: `outcome = 'conflict'` y `error_code = 'slot_taken'`.

### 5. Rechazo de acceso

1. Anota la ruta e ID del cliente elegido y el ID de la conversación de `agente099`.
2. En una ventana privada, inicia sesión como otro agente, por ejemplo `agente001`, y crea una conversación propia.
3. Intenta abrir el ID de conversación de `agente099` mediante `GET /api/conversations/{id-ajeno}`. Debe responder `404` sin mensajes.
4. En la consola del navegador autenticada como el segundo agente, intenta seleccionar el cliente ajeno en una conversación propia. Debe responder `404` sin datos del cliente:

```js
const own = (await (await fetch("/api/conversations")).json()).conversations[0];
const response = await fetch(`/api/conversations/${own.id}/client`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    documentPath: "RUTA_DEL_CLIENTE_AJENO",
    clientRecordId: "ID_DEL_CLIENTE_AJENO"
  })
});
console.log(response.status, await response.json());
```

La cookie se envía automáticamente en esta solicitud same-origin. Sustituye los marcadores por los anotados; no uses datos de otro entorno.

### 6. Resultado vacío y sesión vencida

- **Resultado vacío:** como `agente099`, busca `sin-cliente-demo-987654` (mínimo dos caracteres). Debe aparecer **No encontramos clientes dentro de tu alcance**. También puedes seleccionar un cliente sin cotizaciones coincidentes y comprobar `quotes_status: empty`.
- **Sesión vencida (solo local):** inicia sesión con la cuenta secundaria `agente001`, fuerza la expiración con esta sentencia y recarga. La interfaz debe volver al inicio de sesión; al autenticarte de nuevo se crea otra sesión. El esquema local permite una sola sesión por cuenta, por lo que esto invalida la sesión completa de `agente001`; no uses tu cuenta principal ni una sesión que quieras conservar.

  ```sql
  UPDATE reto.sessions
     SET expires_at = now() - interval '1 second'
   WHERE agent_id = (
     SELECT a.id
       FROM onboarding.accounts AS a
       JOIN reto.account_aliases AS alias ON alias.account_id = a.id
      WHERE alias.username = 'agente001'
   )
  RETURNING agent_id, expires_at;
  ```

  Esto invalida la única sesión de `agente001` solo en la réplica local. No afecta la sesión de `agente099`.

### 7. Fallo simulado del proveedor

La opción automatizada es `npm run test:demo`: crea un servidor HTTP temporal en loopback dentro del contenedor, hace fallar el adaptador real y comprueba `502 assistant_provider_error` y que no se hayan guardado mensajes. Usa configuración y credenciales ficticias solo para ese servidor, sin modificar `.env`, reiniciar el backend ni llamar al proveedor configurado. También funciona si la IA real está deshabilitada. No verifica una respuesta exitosa del proveedor externo ni su facturación.

Para comprobar el mensaje manualmente en la interfaz, se mantiene esta alternativa opcional:

Solo si IA está habilitada. La URL de prueba apunta a loopback dentro del contenedor: falla localmente y no transmite datos al proveedor. En PowerShell, desde la raíz:

```powershell
$env:LLM_BASE_URL = "http://127.0.0.1:1/v1"
docker compose up -d --force-recreate --no-deps backend
Remove-Item Env:LLM_BASE_URL
```

Pregunta al asistente. Debe aparecer un error controlado y no guardarse una respuesta inventada. Restaura inmediatamente la URL del `.env` y el backend:

```powershell
docker compose up -d --force-recreate --no-deps backend
Invoke-RestMethod http://localhost:8008/health
```

No uses una clave inválida contra OpenAI para simular el fallo: la solicitud todavía podría transmitir evidencia.

## Verificar persistencia en PostgreSQL

Abre una consola:

```powershell
docker compose exec postgres psql -U reto -d reto
```

Sustituye los marcadores por los IDs anotados; no incluyas los signos `<>`.

```sql
-- Conversación, cliente activo e historial persistido.
SELECT c.id AS conversation_id, c.owner_account_id,
       c.active_client_path, c.active_client_record_id,
       m.sequence_no, m.sender_role, m.content, m.evidence_refs, m.created_at
  FROM reto.chat_conversations AS c
  LEFT JOIN reto.chat_messages AS m
    ON m.conversation_id = c.id
   AND m.client_document_path IS NOT DISTINCT FROM c.active_client_path
   AND m.client_record_id IS NOT DISTINCT FROM c.active_client_record_id
 WHERE c.id = 'CONVERSATION_UUID'::uuid
 ORDER BY m.sequence_no;

-- Propietario e ID del cliente en el documento seleccionado.
SELECT d.path, d.document->>'ownerKey' AS owner_account_id,
       lead->>'id' AS client_record_id
  FROM public.pbg_state_documents AS d
 CROSS JOIN LATERAL jsonb_array_elements(d.document->'leads') AS lead
 WHERE d.path = 'CLIENT_DOCUMENT_PATH'
   AND lead->>'id' = 'CLIENT_RECORD_ID';

-- Instantáneas analíticas con coincidencia exacta de lead y cuenta.
SELECT q.quote_id, q.lead_id, q.account_id, q.carrier, q.product,
       q.face_amount_cents, q.monthly_premium_cents,
       q.annual_premium_cents, q.created_at
  FROM analytics.quotes AS q
 WHERE q.lead_id = 'CLIENT_RECORD_ID'
   AND q.account_id = 'OWNER_ACCOUNT_ID'
 ORDER BY q.created_at DESC;

-- Citas confirmadas/canceladas de Chat PBG.
SELECT a.id, a.conversation_id, a.agent_account_id, a.client_record_id,
       a.start_at, a.end_at, a.local_start, a.time_zone,
       a.start_utc_offset_minutes, a.status, a.last_confirmation_id
  FROM reto.chat_appointments a
  JOIN reto.chat_conversations c
    ON a.client_document_path = c.active_client_path
   AND a.client_record_id = c.active_client_record_id
 WHERE c.id = 'CONVERSATION_UUID'::uuid
 ORDER BY a.created_at;

-- Auditoría de acciones, incluidos conflictos y claves idempotentes.
SELECT actor_account_id, actor_role, action_type, entity_type, entity_id, outcome, error_code,
       idempotency_key, occurred_at
  FROM reto.chat_actions
 WHERE conversation_id = 'CONVERSATION_UUID'::uuid
 ORDER BY occurred_at;
```

Un replay idempotente no crea otra cita ni otra fila de acción. La consulta de citas anterior incluye otros orígenes conversacionales del mismo cliente; es una consulta de inspección local, no sustituye los filtros de autorización de la API. El calendario consultado es el de Chat PBG, separado de `teamops.bookings`. No publiques resultados sin ocultar nombres, IDs personales, rutas y contenido de mensajes.

## Limitaciones y decisiones pendientes

La demo verifica la implementación con el snapshot local, no las siguientes decisiones de dominio:

- El propietario debe confirmar que `leads-store/books` representa clientes activos de seguros y cómo manejar el acceso histórico después de una transferencia de agencia.
- `analytics.quotes` son instantáneas analíticas. No hay fuente confirmada de emisión, vigencia, aprobación, cobertura contratada o tarifas actuales; tampoco reglas versionadas de elegibilidad, suscripción o recomendación. No se recomienda una cotización.
- La agenda usa `reto.chat_appointments`, el calendario local de la aplicación. Falta confirmar la fuente oficial de citas de seguros, horarios laborales, feriados, bloqueos externos, duración por tipo y política de cancelación.
- El snapshot presenta un rol y agencia actuales por cuenta. No demuestra asignaciones con vigencia ni roles múltiples. El alcance administrativo implementado aún requiere validación del propietario del producto.
- Los binarios referenciados en S3/R2 no forman parte de la réplica. No se hacen llamadas, correos, cobros ni escrituras en producción.
- La IA es opcional y depende de credenciales, facturación y autorización externa. Solo recibe los campos acotados descritos en la API; ante fallo del proveedor no se genera una respuesta sustituta.
- El listado puede mostrar citas del cliente creadas en otra conversación. La modificación exige volver a la conversación de origen; este recorrido no amplía esa restricción.

## Comprobaciones existentes y resultados

Desde la raíz, en PowerShell:

```powershell
npm ci
npm --prefix backend ci
npm --prefix frontend ci
docker compose up -d --build
npm run check:backend
npm run check:frontend
npm run test:authorization
npm run test:appointment-workflow
npm test
$LASTEXITCODE
npx playwright install chromium
npm run test:ui
$LASTEXITCODE
uv run --with cryptography --with pyahocorasick python -m unittest discover -s tests -p 'test_replica.py'
$LASTEXITCODE
```

- `npm test` necesita Compose activo e incluye API/autenticación, integridad de la base restaurada, datos locales y el nuevo recorrido de demo. Para ejecutar solo este último usa `npm run test:demo`.
- `npm run test:ui` necesita la aplicación en `http://localhost:8088` y Chromium instalado. Además de login, recarga, logout y vista móvil, recorre el modal, renombrado, selección de cliente, consultas, ficha y regreso, cita por chat con fecha `DD/MM/AAAA`, restauración de confirmación al recargar, listado, conservación del módulo al cerrar y adaptación del modal a móvil.
- La prueba Python comprueba el enmascarado y la conservación de valores y referencias. Los checksums de los archivos distribuidos y la fidelidad SQL se verifican con `npm test`.
- Si no tienes `uv`, instala `cryptography` y `pyahocorasick` en un entorno virtual y ejecuta `python -m unittest discover -s tests -p 'test_replica.py'`.
- Ejecuta las suites en secuencia: la aplicación mantiene una sesión por cuenta. API/demo usa `agente099` y `agente002`; UI usa `agente099` y `agente001`; las pruebas existentes también acceden a las cuentas de roles recomendadas. Iniciar las pruebas puede cerrar las sesiones que tengas abiertas con esas cuentas.
- Las demos crean conversaciones cuyo título empieza por `Demo PBG-14` o `Demo UI PBG-14` y conservan historial y auditoría para inspección. Al finalizar cancelan mediante la API la cita que crearon, para liberar el horario. No borran registros previos ni modifican los documentos originales. La demo de API expira únicamente la sesión secundaria creada para esa ejecución.
- El recorrido automatizado selecciona sus clientes desde el snapshot y busca un intervalo libre futuro. Rechaza una `API_URL` remota; si usas otros puertos locales, establece `API_URL` y `WEB_URL` de forma coherente antes de ejecutar.
- Conserva la salida completa y el código `$LASTEXITCODE` de cada comando. Éxito corresponde a código `0` y cero pruebas fallidas. Las trazas de errores de Playwright quedan en `test-results/`, ignorado por Git; pueden contener información del cliente, así que mantenlas locales.

### Validación ejecutada el 22/10/2026

Se reconstruyeron backend y frontend con Docker Compose y se ejecutaron las
comprobaciones contra PostgreSQL local. Resultados finales:

| Comprobación | Resultado |
| --- | --- |
| Construcción de backend y frontend en Compose | Correcta, código 0 |
| `npm run check:backend` y `npm run check:frontend` | Sin errores de tipos |
| `npm run test:authorization` | 37 pruebas aprobadas |
| `npm run test:appointment-workflow` | 14 pruebas aprobadas |
| `npm test` | 16 pruebas aprobadas, incluidas las de demo |
| `npm run test:demo` | 10 pruebas aprobadas: contenedora y 9 escenarios |
| `npm run test:ui` | 3 pruebas aprobadas en Chromium |
| `tests/test_replica.py` | 8 pruebas aprobadas |
| `git diff --check` | Sin errores de espacios |

Las pruebas de navegador detectaron y permitieron corregir la selección repetida
de una conversación activa: ya no invalida la carga del historial sin iniciar
otra. El recorrido verifica esta selección después de recargar y una vez
recuperada la propuesta de cita.

La prueba Python se ejecutó con el intérprete disponible en el entorno de Codex
y `pyahocorasick` instalado en `.private/demo-python`, ignorado por Git. No se
necesitó cambiar los archivos del respaldo.

El proveedor externo real no se invocó. El escenario de fallo usa el adaptador
real contra un servidor temporal que responde 503 en loopback; comprueba el 502
de la API y que el número de mensajes permanezca intacto. La respuesta exitosa
del proveedor contratado queda fuera de estos resultados.

### Cobertura de los criterios de PBG-14

| Criterio | Evidencia reproducible |
| --- | --- |
| Arranque, cuenta, recorrido y persistencia | Preparación, pasos de interfaz y SQL de esta guía |
| Conversación, expediente, cotizaciones y cita | `tests/demo-flow.test.mjs` y `tests/ui/chat-demo.spec.js` |
| Idempotencia, conflicto y rechazo de acceso | Escenarios API con comprobación de citas y auditoría SQL |
| Sesión vencida, resultado vacío y fallo del proveedor | Escenarios API y alternativas manuales documentadas |
| Limitaciones y ejecución de comprobaciones | Secciones anteriores y tabla de resultados finales |
