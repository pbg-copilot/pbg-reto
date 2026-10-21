# Matriz de permisos y política de alcance — Chat PBG

**Estado:** política funcional definida para implementar. No afirma que los endpoints de chat ya existan.  
**Relacionado:** [`spec.md`](./spec.md), [`data-model.md`](./data-model.md).

## 1. Principios

1. La identidad viene de la sesión autenticada. Rol, agencia, propietario, cliente y permiso enviados por UI o modelo nunca conceden acceso.
2. Cada lectura y acción se autoriza en backend contra las asignaciones vigentes en ese momento. Las consultas aplican filtros de alcance antes de recuperar datos; las escrituras vuelven a validar dentro de su transacción.
3. El alcance se limita a los recursos de negocio del reto. No incluye por defecto hashes, sesiones, OTP, credenciales, secretos, datos de facturación ni otras áreas de operación.
4. Se falla en forma cerrada cuando no puede probarse una relación entre usuario, agencia, expediente, cotización o cita. No se amplía alcance a partir de un ID, texto de chat o coincidencia de nombre.
5. Se solicitan únicamente los campos necesarios. La lectura de un recurso no implica permiso para mutarlo.

## 2. Matriz por rol y recurso

`Lectura` se refiere solo a campos de negocio permitidos por caso de uso. La conversación y sus mensajes siempre tienen propietario individual, con la condición adicional de conservar acceso al expediente asociado.

| Recurso / acción | `agent` | `agency_owner` | `admin` |
| --- | --- | --- | --- |
| Clientes/libros: buscar y leer | Sus expedientes propios, solo cuando el vínculo con su cuenta esté verificado. No hereda los expedientes de colegas por compartir agencia. | Expedientes de miembros actuales de su agencia, solo cuando se haya verificado su ownership y pertenencia a esa agencia. No accede a otras agencias. | Lectura de los expedientes de negocio autorizados del entorno del reto, limitada a campos necesarios; no a credenciales ni datos fuera de ese dominio. |
| Clientes/libros: modificar | No disponible en el alcance del reto. | No disponible en el alcance del reto. | No disponible en el alcance del reto. |
| Cotizaciones: consultar/comparar | Solo cotizaciones vinculadas de forma verificable a un expediente propio. | Cotizaciones vinculadas de forma verificable a expedientes de su agencia. | Lectura global limitada al dominio de cotizaciones del reto, con campos permitidos. |
| Cotizaciones: crear, editar o aprobar | No permitido. | No permitido. | No permitido desde el chat. |
| Citas: consultar | Citas cuyo agente responsable sea la cuenta autenticada, y cuyo cliente siga en su alcance. | Citas de agentes actualmente pertenecientes a su agencia y clientes en alcance. | Lectura global de citas del dominio del reto, con campos permitidos. |
| Citas: crear, modificar o cancelar | Permitido para citas donde sea el agente responsable, con cliente accesible, confirmación vigente y controles de agenda. | No por el rol de dueño solamente. Requiere una asignación explícita y vigente de gestión de agenda para el agente afectado. | No permitido por el rol de admin. Requiere delegación explícita de agenda si el producto la habilita. |
| Información de agencia | Solo datos básicos de su agencia actual necesarios para el flujo; sin roster ni expedientes de colegas. | Su propia agencia y roster vigente. Puede consultar datos de negocio autorizados de su agencia según las filas anteriores. | Metadatos de las agencias del entorno; sin acceso automático a conversaciones ni campos privados irrelevantes. |
| Conversaciones y mensajes | Crear, listar, recuperar y usar solo sus propias conversaciones; el cliente activo también debe seguir dentro de su alcance. | Igual; ser dueño de agencia no permite leer conversaciones de miembros. | Igual; admin no puede leer el contenido de conversaciones ajenas. |
| Auditoría de acciones | Consultar resultados de sus propias acciones en la conversación propia. | Sin acceso general a auditoría individual de miembros. | Acceso a metadatos de auditoría de negocio del reto para soporte/auditoría, con acceso al contenido personal minimizado. |

Los roles no listados en la matriz (incluido `appeal_officer` del respaldo) no tienen acceso al chat ni a sus datos hasta que una política explícita les conceda capacidades. Un rol desconocido o nulo se deniega por defecto.

### Regla de cotizaciones y citas

La ruta de cotizaciones devuelve solo filas de `analytics.quotes` cuyos `lead_id` y `account_id` coinciden exactamente con el ID del cliente activo y el propietario activo del libro. Además aplica el alcance de la sesión antes de consultar. La decisión de producto del MVP es exponerlas como instantáneas analíticas, no como ofertas vigentes/aprobadas; no infiere coberturas ni elegibilidad. `teamops.bookings` sigue siendo un flujo interno, no una fuente confirmada de citas de seguros. El control de acceso y la coincidencia de IDs no sustituyen una fuente autoritativa si en el futuro se agregan acciones comerciales.

## 3. Cómo se calcula el alcance

### Identidad y estado

- Resolver `account_id`, `role` y `agency_id` desde la sesión activa y las tablas originales; rechazar sesión vencida o cuenta inactiva.
- El rol determina capacidades; la agencia determina la frontera de datos para `agency_owner`.
- No aceptar `account_id`, `role`, `agency_id`, `ownerKey`, propietario del registro ni política de acceso como autoridad desde una petición.

### Cliente y pertenencia

- Para la búsqueda del chat, el backend vincula el `ownerKey` del libro con `onboarding.accounts.id` por igualdad exacta; el análisis de la copia pudo verificar esa igualdad en los 62 documentos decodificables. No se usan coincidencias de email, alias o nombre. Un libro sin una cuenta activa coincidente queda inaccesible.
- Un dueño accede a expedientes solo si se puede probar simultáneamente la pertenencia del propietario a una cuenta activa con `agency_id` igual a su agencia actual y la pertenencia del expediente a ese propietario/agencia.
- `accounts.agency_id → agencies.id` y `agencies.owner_account_id → accounts.id` tienen FKs declaradas. El alcance del dueño se calcula desde `accounts.agency_id` de cuentas activas. `agency_team_leads` no tiene FKs declaradas y no amplía el alcance bajo esta política; una futura delegación requeriría un permiso explícito y referencias verificadas. Las relaciones con `removed_at IS NOT NULL` nunca cuentan como activas.
- Si la relación expediente↔cuenta/agencia no se puede probar, devolver sin resultados o acceso no disponible; no exponer el libro a un agente o agencia por defecto.

### Cotizaciones y citas

- Autorizar primero el cliente y después el recurso relacionado. El ID de quote/appointment nunca prueba que el usuario tenga acceso al cliente.
- Solo admitir cotización o cita si existe una relación de negocio confirmada en el servidor entre registro, cliente, agente/agencia y contexto del reto.
- Las operaciones de agenda vuelven a autorizar agente, cliente, recurso y estado en la transacción que persiste el cambio.

## 4. Vigencia, roles múltiples y cambios de agencia

- Las concesiones tienen `valid_from` y un `valid_until` opcional. Una concesión aplica si `valid_from <= now()` y (`valid_until IS NULL` o `now() < valid_until`). La cuenta y asignación también deben estar activas.
- Si hay varias asignaciones activas verificadas, las capacidades y alcances se unen. Una asignación vencida o revocada no aporta permisos. Un rol de solo lectura no cancela ni amplía una capacidad de escritura concedida por otra asignación.
- Una transferencia de agencia cierra la asignación anterior y activa la nueva desde su fecha efectiva. Las nuevas solicitudes usan solo el alcance vigente; no hay acceso retroactivo a la agencia anterior salvo asignación histórica explícita aún vigente.
- Las conversaciones no cambian de propietario por transferencia. Si el creador pierde acceso al cliente activo, no se recupera el historial con contenido de ese expediente hasta que vuelva a tener permiso; la API oculta el recurso con la política de error indicada abajo.
- Si no se pueden determinar fechas, revocación o alcance, no inferir concesiones vigentes a partir de datos históricos.

### Límite del esquema actual

En la réplica, `onboarding.accounts` contiene un único `role` y `agency_id` actual. No hay tabla de concesiones con fechas de inicio/fin; `agency_team_leads` conserva `removed_at` pero no define por sí sola una asignación de rol. La regla temporal y multirol anterior es la política objetivo, no capacidad demostrada por el esquema actual. Antes de implementarla se necesita una tabla de asignaciones efectiva-dated o una fuente autorizada equivalente; no simular historial con sobrescrituras de `accounts.role`/`agency_id`.

## 5. Conversaciones, confirmaciones y auditoría

- Cada conversación pertenece a una sola cuenta creadora. Agencia y admin no implican conversación compartida.
- Recuperar historial comprueba propietario, cliente activo y alcance actual antes de devolver mensajes o evidencia.
- Cambiar el cliente activo reemplaza el contexto activo; no cambia permisos ni revela mensajes/evidencia del cliente anterior.
- La confirmación de agenda queda ligada al creador, cliente, agente responsable, acción, intervalo y zona horaria exactos. Cambio de cualquier campo invalida la confirmación.
- La auditoría registra actor, rol y asignación usados, scope/agency aplicado, acción, entidad/ID, resultado, fecha y clave idempotente cuando exista. Nunca registra secretos ni el contenido completo del expediente por defecto.

## 6. Respuestas de autorización

- `401` para sesión ausente, inválida o vencida.
- `404` para recurso individual fuera de alcance o inexistente, para no revelar si el ID ajeno existe.
- `403` para una acción que el rol no puede realizar sobre un recurso que sí está en su alcance (por ejemplo, admin intentando crear una cita bajo esta política).
- Colecciones autorizadas sin registros devuelven una lista vacía; un ID manipulado no devuelve datos parciales ni campos del recurso.

## 7. Casos de aceptación para implementación

1. Un agente ve su expediente con ownership confirmado y no ve el del colega de la misma agencia.
2. Un agente no obtiene un expediente de otra agencia aunque cambie el ID del libro o el parámetro `ownerKey`.
3. Un dueño ve recursos de miembros actuales de su agencia, no los de otra agencia ni de miembros retirados/no verificables.
4. Un administrador puede leer datos de negocio autorizados de cualquier agencia, pero no leer mensajes de conversaciones ajenas ni escribir citas/cotizaciones.
5. Un usuario que tiene dos asignaciones vigentes obtiene la unión de sus permisos; una asignación vencida no concede acceso.
6. Tras una transferencia de agencia, consultas nuevas usan la agencia nueva; registros anteriores quedan rechazados salvo asignación vigente explícita.
7. Conversaciones son privadas por usuario y no se recuperan con evidencia si el cliente dejó de estar dentro del alcance del propietario.
8. Buscar, listar, leer detalle y mutar aplican la misma política; solicitudes manipuladas se comprueban también por endpoint/herramienta.
9. Los errores no contienen nombre, teléfono, email, nota, prima u otros datos del registro no autorizado.

## 8. Decisiones pendientes del propietario de datos/producto

- Confirmar con el propietario del dominio que los libros representan clientes activos de seguros y si una transferencia de agencia debe preservar acceso histórico; la implementación actual aplica la cuenta y agencia activas del propietario.
- Una futura función que afirme emisión, vigencia o aprobación de cotizaciones requiere estados y fuente autoritativa; la consulta analítica actual no hace esas afirmaciones.
- Identificar la tabla aprobada de citas de seguro y quién puede delegar su gestión.

## 9. Estado de implementación

- `backend/src/authorization.ts` resuelve el principal desde el hash de sesión y aplica el alcance a conversaciones, clientes, cuentas y agencias. Las conversaciones se filtran por `owner_account_id`; los clientes se vinculan por `ownerKey = accounts.id` y cuenta propietaria activa.
- Un hook de `backend/src/server.ts` exige una sesión activa y rol admitido en todas las rutas salvo salud, inicio y cierre de sesión. `/api/clients` y `POST /api/conversations/:conversationId/client` buscan/seleccionan dentro del alcance; la selección vuelve a validar sesión, conversación y cliente dentro de una transacción.
- Las consultas de cuentas y agencias también toman sus IDs de objetivo como selectores y aplican en SQL el alcance derivado del principal. Los campos de agencia, propietario y rol nunca se aceptan como autoridad desde HTTP.
- Los libros con `ownerKey` vinculable a una cuenta activa se pueden buscar y seleccionar. Cotizaciones y citas siguen inaccesibles porque el snapshot no confirma su vínculo de negocio con el cliente.
- La selección/cambio de cliente actualiza la conversación y registra `reto.chat_actions` atómicamente. No hay aún mutaciones de clientes, cotizaciones o citas.
- El snapshot conserva un solo rol y agencia actuales por cuenta. Roles múltiples, vigencias y cambios históricos requieren una fuente autorizada antes de poder evaluarse.
