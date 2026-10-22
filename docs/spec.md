# Especificación funcional y técnica — Chat PBG

**Estado:** propuesta derivada de la guía del reto y del simulacro de preparación.  
**Fecha de referencia:** 20 de octubre de 2026.

## 1. Propósito y alcance

Implementar un asistente conversacional para agentes y agencias de seguros que permita consultar clientes y cotizaciones, identificar información faltante y gestionar citas. Las respuestas y acciones deben respetar los permisos del usuario conectado.

Esta especificación separa los requisitos de `Reto_Chat_PBG.pdf` de las decisiones propuestas durante el simulacro. Los detalles dependientes del esquema local quedan como pendientes de verificación.

### Conversaciones y expedientes

- Crear, guardar, recuperar y seleccionar conversaciones y sus mensajes.
- Permitir que el usuario cambie y guarde el nombre de sus conversaciones.
- Buscar conversaciones por título, datos del cliente activo y contenido visible del historial, respetando el contexto de cliente actual.
- Mantener un único cliente activo por conversación. Registrar explícitamente los cambios de cliente.
- Vincular consultas y evidencia con la conversación y el cliente correspondiente.
- Mostrar en el historial solo mensajes del cliente activo. Al cambiar de cliente, limpiar la vista y cargar el historial asociado al nuevo contexto.
- Al recuperar el historial, comprobar la pertenencia de la conversación al usuario y el acceso actual al cliente.
- Al cambiar de cliente, cargar nuevamente la evidencia del expediente; nunca reutilizar hechos o cotizaciones del anterior.
- Mostrar claramente el cliente activo y mantener aislados los contextos. Conservar las referencias de procedencia en el backend para trazabilidad, pero no presentar IDs, rutas o fuentes internas en la interfaz.

### Consultas y cotizaciones

- Consultar perfiles, notas, actividad, cotizaciones y citas existentes dentro del alcance autorizado.
- Conservar la procedencia de la información (identificador del registro/documento, fecha y cliente asociado) en el backend; no exponerla en la interfaz.
- Distinguir hechos registrados, resultados de reglas y datos faltantes.
- Comparar cotizaciones existentes y explicar qué información falta para continuar.
- Aplicar solo reglas explícitas, documentadas y versionadas. Si la regla es ausente, no vigente o insuficiente, indicarlo.
- No inventar precios, coberturas, elegibilidad ni aprobaciones.

### Agenda

- Consultar, crear, modificar y cancelar citas mediante la API autenticada.
- Permitir iniciar la creación de citas desde el chat con recopilación determinista de fecha, hora, duración y zona horaria, y respuestas persistidas en el historial.
- Antes de guardar, pedir confirmación explícita de cliente, agente, fecha, hora, duración y zona horaria.
- La confirmación corresponde a esos valores exactos; cualquier cambio requiere nueva confirmación.
- Convertir la hora local usando la zona IANA elegida. Persistir `start_at`/`end_at` como instantes `timestamptz`, junto con el identificador IANA; opcionalmente conservar hora local y offset resuelto para reconstruir la solicitud.
- Rechazar horas locales ambiguas o inexistentes por cambio estacional, o pedir que se elija el instante.
- Evitar cruces de citas por agente con rangos de tiempo y restricción de exclusión GiST (o mecanismo equivalente con garantía transaccional en PostgreSQL).
- Usar clave de idempotencia única por operación lógica. El reintento con la misma clave devuelve el resultado ya registrado; los conflictos de horario se informan sin reintento ciego.
- Mostrar un aviso descartable cuando una cita del cliente activo está programada para el día siguiente en la zona horaria de esa cita.

### Seguimientos pendientes

- Permitir que un agente registre un seguimiento breve asociado al cliente activo y una fecha local, consultar sus pendientes y marcarlos como completados.
- Persistir los seguimientos en PostgreSQL y auditar creación y cierre; el backend deriva el cliente de la conversación y rechaza cambios de contexto entre formulario y escritura.

### Persistencia y trazabilidad

- Persistir conversaciones, mensajes y acciones en PostgreSQL mediante migraciones.
- Para cada modificación registrar actor, acción, registro afectado, resultado y momento; vincular conversación y clave idempotente cuando aplique.
- Registrar fuentes usadas para respaldar respuestas, sin tratar las referencias como autorización.

## 2. Permisos y aislamiento

- La matriz por recurso/acción, semántica de asignaciones vigentes, acceso a conversaciones y respuestas de error está definida en [`permissions.md`](./permissions.md).
- Política: `agent` accede a expedientes propios; `agency_owner`, a expedientes de miembros activos de su agencia; `admin`, a lectura global solo del dominio de negocio del reto. `admin` no lee conversaciones ajenas ni realiza mutaciones de agenda/cotizaciones desde el chat.
- Derivar identidad y rol de la sesión autenticada. El cliente activo del navegador y el modelo no otorgan permisos.
- Autorizar cada endpoint y cada llamada a herramienta en backend antes de leer datos o ejecutar cambios. Las consultas SQL incluyen alcance explícito; las escrituras vuelven a validarlo dentro de la transacción.
- Los roles múltiples vigentes combinan permisos; las asignaciones vencidas/revocadas no dan acceso. El esquema actual conserva un rol/agencia actual, por lo que asignaciones con vigencia requieren una fuente autorizada antes de implementarse.
- Los documentos del cliente se autorizan por ownership verificable. La ruta de cotizaciones solo muestra filas con coincidencia exacta entre `lead_id`/ID del cliente y `account_id`/propietario activo, bajo la semántica del MVP de instantáneas analíticas y no ofertas comerciales. No contiene una fuente confirmada de citas de seguros.
- Las conversaciones y mensajes son privados por creador. Al recuperar el historial se comprueban propietario y acceso actual al cliente vinculado; el historial nunca concede acceso retroactivo.
- Rechazar accesos fuera de alcance sin revelar campos del registro ajeno; usar 401, 404 o 403 según [`permissions.md`](./permissions.md).
- Preservar en auditoría el actor y alcance aplicado.

### Pruebas de permisos

- Un agente ve sus expedientes con ownership confirmado; otro agente recibe rechazo sin datos. La ruta de cotizaciones solo expone coincidencias exactas dentro de su alcance, con procedencia y semántica de instantánea analítica; no afirma vigencia ni aprobación. Las citas de seguros siguen sin fuente confirmada.
- Un dueño solo ve recursos autorizados de su agencia.
- Cambiar IDs de cliente, cotización, cita o agencia en URL, cuerpo o argumentos de herramienta no amplía acceso.
- Asignaciones múltiples y vencidas se evalúan según la política vigente del proyecto.
- Probar búsqueda, detalle, historial y modificaciones; verificar código de respuesta y ausencia de nombres, importes, notas u otros datos privados en errores.

## 3. Responsabilidades técnicas

### Backend

- Autenticar y autorizar solicitudes; resolver contexto desde referencias validadas.
- Recuperar evidencia autorizada conservando su procedencia y aplicar reglas deterministas documentadas.
- Preparar confirmaciones exactas de agenda, exigir su aceptación antes de guardar, y revalidar cliente, agente, horario, zona y estado dentro de la transacción. PostgreSQL impide solapamientos activos por agente; las claves idempotentes reproducen el resultado auditado.
- Persistir conversación, mensajes, claves de idempotencia y auditoría.
- Producir respuestas estructuradas con evidencia y faltantes.

### Modelo de lenguaje, si se habilita

- Recibir únicamente evidencia y resultados de reglas ya autorizados por el backend.
- Redactar, resumir y explicar; no acceder directamente a PostgreSQL, decidir permisos ni inferir precios, coberturas o aprobaciones ausentes.
- Las herramientas son operaciones controladas por backend con esquemas estrictos; todos los argumentos se validan.
- Ante fallo del proveedor, devolver error controlado sin conjeturas.
- La versión mínima viable puede ser determinista y no usar un proveedor externo. Si se integra IA, documentar modelo y configuración por variables de entorno; no enviar datos personales a terceros sin autorización específica.

### API y base de datos

- Mantener frontend React/TypeScript y backend Fastify/TypeScript separados mediante API autenticada.
- Reutilizar login/sesión/logout existentes (`POST /auth/get-toke`, `GET /auth/me`, `POST /auth/logout`).
- Presentar historial por conversación, búsqueda/selección del cliente activo y consultas de expediente/cotizaciones con datos, faltantes y estados de carga, vacío y error; mantener la procedencia solo en backend. Al cambiar conversación o cliente, limpiar resultados y mostrar solo el historial de ese cliente; ante `401`, volver al inicio de sesión.
- Permitir crear, reprogramar y cancelar citas desde el contexto del chat mediante una propuesta exacta que el usuario puede confirmar o descartar. Los campos modificados descartan la propuesta; los conflictos y reintentos conservan los controles de idempotencia del backend.
- La API autenticada de conversaciones, su historial y el guardado de mensajes de usuario están documentados en [`api-conversations.md`](./api-conversations.md); las lecturas validan propiedad y ordenan por secuencia estable.
- Añadir servicios/endpoints para conversaciones, búsqueda/detalle de clientes, cotizaciones y agenda. La ruta de cotizaciones, que exige coincidencia exacta de IDs y devuelve procedencia/faltantes, está documentada en [`api-conversations.md`](./api-conversations.md). La búsqueda/selección valida `ownerKey` por igualdad exacta con `onboarding.accounts.id` y falla cerrada si no resuelve.
- La consulta de disponibilidad recibe hora local, duración y zona IANA, valida horas ambiguas/inexistentes y compara instantes UTC contra citas confirmadas de `reto.chat_appointments`; su alcance y limitaciones están documentados en [`api-appointments.md`](./api-appointments.md).
- Conservar estructura de negocio original y relaciones; añadir tablas mediante migraciones, sin sustituir documentos originales por modelos ficticios.
- El modelo inspeccionado de expedientes, cotizaciones, agencia y bookings, con sus relaciones y límites, está documentado en [`data-model.md`](./data-model.md). Las APIs deben conservar esas distinciones.

## 4. Criterios de aceptación

1. Iniciar sesión y recuperar una conversación guardada.
2. Seleccionar un cliente permitido y resumir sus datos citando registros de respaldo.
3. Consultar cotizaciones y explicar datos o reglas faltantes sin inventar resultados.
4. Agendar cita confirmada y comprobarla en PostgreSQL.
5. Consultar información de agencia con rol autorizado.
6. Rechazar acceso a datos de otro agente o agencia.
7. Manejar sesión vencida, consulta sin resultados y fallo del proveedor de IA.
8. Evitar cruces y duplicados bajo concurrencia y reintentos.
9. Encontrar conversaciones por cliente, título y contenido; registrar y completar seguimientos asociados al cliente, y descartar el aviso de cita para mañana.

## 5. Entrega mínima priorizada

1. Conversaciones y mensajes persistidos y recuperables bajo sesión autenticada.
2. Búsqueda/selección de cliente con autorización por registro.
3. Resumen de perfil y cotizaciones con fuentes y faltantes.
4. Agenda transaccional con confirmación, zona horaria, bloqueo de solapamientos, idempotencia y auditoría.
5. Manejo de errores y demo reproducible con datos locales autorizados.
6. La IA opcional redacta únicamente el perfil y las cotizaciones recuperados y autorizados por backend; no recibe herramientas, no tiene acceso directo al almacenamiento y no toma decisiones comerciales. Su proveedor/modelo se configura con variables de entorno y la transmisión de datos personales permanece deshabilitada salvo autorización específica del responsable de datos.

## 6. Verificación manual de extremo a extremo

1. Iniciar sesión con cuenta local documentada y crear conversación.
2. Recargar y recuperar conversación y cliente activo.
3. Seleccionar cliente permitido, consultar perfil/cotizaciones y contrastar IDs de evidencia con PostgreSQL.
4. Agendar y confirmar cita; comprobar cita y auditoría en PostgreSQL.
5. Repetir con la misma clave idempotente y comprobar que no hay duplicado; probar un horario en conflicto.
6. Probar acceso fuera de alcance a cliente, cotización y cita, y comprobar rechazo sin filtración.
7. Probar sesión vencida, resultado vacío y fallo simulado del proveedor.

La demo no se conecta a producción ni ejecuta llamadas, correos o cobros.

## 7. Pendientes y limitaciones a documentar

- Confirmar cuentas, roles y relaciones en README/base local. La guía adjunta indica 350.217 registros; el README local también indica 350.217 distribuidos y 351.429 en el respaldo. Para el estado local usar la base y README; para los requisitos usar la guía.
- Confirmar con el propietario del dominio si `leads-store/books` representa clientes activos de seguros y si una transferencia de agencia preserva acceso histórico. La API ya usa igualdad exacta de `ownerKey` con `accounts.id` y calcula el alcance con la asignación actual.
- Para futuras funciones comerciales, definir una fuente que confirme emisión, vigencia y aprobación de cotizaciones; la consulta actual usa coincidencia exacta como vínculo técnico y no afirma esos estados.
- Identificar una fuente autorizada para citas de agentes de seguros; `teamops.bookings` describe flujos internos de demo/consultoría y no cubre ese caso por sí sola.
- Confirmar la fuente autorizada para asignaciones múltiples/vigentes; el esquema actual solo refleja un rol/agencia actual.
- Confirmar reglas de opciones, responsable y vigencia. Sin reglas verificables no se emiten recomendaciones automáticas.
- Confirmar horarios laborales, duración por tipo de cita y políticas de cancelación/modificación.
- Declarar reglas comerciales no disponibles; mostrar los campos de cotización como valores analíticos almacenados, sin afirmar emisión, vigencia, cobertura o aprobación. La redacción de IA es opcional y depende de un proveedor compatible configurado; una falla produce un error controlado. Documentar medios binarios externos ausentes.
