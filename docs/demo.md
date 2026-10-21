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

## Recorrido de demostración

### 1. Conversación, expediente y cotizaciones

1. Inicia sesión y pulsa **Nueva conversación**.
2. En **Buscar cliente**, escribe al menos dos caracteres y selecciona un resultado permitido. La interfaz muestra el nombre del cliente activo, pero oculta sus IDs y rutas internas. Para contrastar SQL, obtén los identificadores desde las respuestas de API en la pestaña **Network** o consultando la base local.
3. Pulsa **Ver expediente** y **Ver cotizaciones**. La interfaz muestra los datos y faltantes sin exponer IDs ni fuentes internas. Las cotizaciones se describen como instantáneas analíticas, no como ofertas vigentes, aprobadas o emitidas.
4. Si la IA está habilitada, pregunta: “Resume los datos disponibles y enumera qué falta para evaluar las cotizaciones”. La respuesta resume la evidencia sin mostrar IDs ni fuentes internas. Si está deshabilitada, no se presenta una respuesta generada; las consultas deterministas siguen disponibles.
5. Recarga y vuelve a abrir la conversación. Deben persistir historial y cliente activo, sin mezclar conversaciones.

### 2. Cita confirmada

1. En **Agenda**, elige **Nueva cita**. Selecciona una fecha futura y un intervalo sin conflicto, duración y zona `America/Bogota`.
2. Pulsa **Revisar cita** y comprueba cliente, agente, inicio, fin, zona y offset.
3. Pulsa **Confirmar operación**. La interfaz muestra **Cita creada** y el ID.
4. Ejecuta las consultas SQL de abajo: la cita debe estar en `reto.chat_appointments` con estado `confirmed`, y la acción debe aparecer en `reto.chat_actions`.

La confirmación vence en cinco minutos. Si cambia un valor, prepara otra.

### 3. Idempotencia y conflicto

**Replay idempotente:** en las herramientas de desarrollador del navegador, pestaña **Network**, localiza el `POST /api/conversations/{conversationId}/appointments` exitoso. Reenvía exactamente la misma solicitud, con el mismo `confirmationId` y `idempotencyKey` (por ejemplo, **Edit and resend**). Debe devolver el mismo ID y `idempotent_replay: true`; no debe aparecer otra cita ni otra acción de escritura para esa clave. No cambies esos valores.

**Conflicto:** en la misma conversación y para el mismo agente, prepara otra cita para el mismo intervalo confirmado. Confirma la propuesta nueva. Debe recibirse `409 slot_taken`, mostrarse un conflicto controlado y conservarse la cita original sin una segunda fila confirmada. La propuesta nueva no reutiliza la confirmación ni la clave anteriores.

En `reto.chat_actions`, creación: `outcome = 'succeeded'`; conflicto: `outcome = 'conflict'` y `error_code = 'slot_taken'`.

### 4. Rechazo de acceso

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

### 5. Resultado vacío y sesión vencida

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

### 6. Fallo simulado del proveedor (opcional)

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
  LEFT JOIN reto.chat_messages AS m ON m.conversation_id = c.id
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
SELECT id, agent_account_id, client_record_id, start_at, end_at,
       local_start, time_zone, start_utc_offset_minutes, status,
       last_confirmation_id
  FROM reto.chat_appointments
 WHERE conversation_id = 'CONVERSATION_UUID'::uuid
 ORDER BY created_at;

-- Auditoría de acciones, incluidos conflictos y claves idempotentes.
SELECT action_type, entity_type, entity_id, outcome, error_code,
       idempotency_key, occurred_at
  FROM reto.chat_actions
 WHERE conversation_id = 'CONVERSATION_UUID'::uuid
 ORDER BY occurred_at;
```

Un replay idempotente no crea otra cita ni otra fila de acción. El calendario consultado es el de Chat PBG, separado de `teamops.bookings`. No publiques resultados sin ocultar nombres, IDs personales, rutas y contenido de mensajes.

## Limitaciones y decisiones pendientes

La demo verifica la implementación con el snapshot local, no las siguientes decisiones de dominio:

- El propietario debe confirmar que `leads-store/books` representa clientes activos de seguros y cómo manejar el acceso histórico después de una transferencia de agencia.
- `analytics.quotes` son instantáneas analíticas. No hay fuente confirmada de emisión, vigencia, aprobación, cobertura contratada o tarifas actuales; tampoco reglas versionadas de elegibilidad, suscripción o recomendación. No se recomienda una cotización.
- La agenda usa `reto.chat_appointments`, el calendario local de la aplicación. Falta confirmar la fuente oficial de citas de seguros, horarios laborales, feriados, bloqueos externos, duración por tipo y política de cancelación.
- El snapshot presenta un rol y agencia actuales por cuenta. No demuestra asignaciones con vigencia ni roles múltiples. El alcance administrativo implementado aún requiere validación del propietario del producto.
- Los binarios referenciados en S3/R2 no forman parte de la réplica. No se hacen llamadas, correos, cobros ni escrituras en producción.
- La IA es opcional y depende de credenciales, facturación y autorización externa. Solo recibe los campos acotados descritos en la API; ante fallo del proveedor no se genera una respuesta sustituta.

## Comprobaciones existentes y resultados

Desde la raíz, en PowerShell:

```powershell
npm ci
docker compose up -d --build
npm test
$LASTEXITCODE
npx playwright install chromium
npm run test:ui
$LASTEXITCODE
uv run --with cryptography --with pyahocorasick python -m unittest discover -s tests -p 'test_replica.py'
$LASTEXITCODE
```

- `npm test` necesita Compose activo e incluye pruebas de API/autenticación, integridad de la base restaurada y datos locales.
- `npm run test:ui` necesita la aplicación en `http://localhost:8088` y Chromium instalado. La suite UI existente cubre login, sesión al recargar, logout y vista móvil.
- La prueba Python valida checksums, estructura y relaciones del respaldo.
- Conserva en pantalla la salida completa y el código `$LASTEXITCODE` de cada comando. Éxito corresponde a código `0` y cero pruebas fallidas. La suite UI no recorre el chat y la agenda de punta a punta; usa también los pasos manuales de esta guía para cliente, citas, idempotencia, conflicto y aislamiento.
