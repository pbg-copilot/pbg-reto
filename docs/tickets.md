# Backlog de implementación — Chat PBG

Desglosado de [`spec.md`](./spec.md). Los tickets son propuestas de trabajo; no implican que estén implementados. La secuencia expresa dependencias, no estimaciones.

## Fase 0 — Confirmar datos y reglas

### PBG-01 — Documentar el modelo real de clientes, cotizaciones y agenda

**Objetivo:** identificar fuentes de datos y relaciones que consumirá el chat antes de codificar consultas de negocio.

**Alcance:** inspeccionar esquemas, columnas, claves, documentos JSON/JSONB, estados y relaciones originales. Confirmar cuentas y roles locales desde README y base restaurada. No modificar datos del respaldo.

**Criterios de aceptación:**

- Hay documentación breve de las entidades y joins usados para cliente, cotización, cita y agencia.
- Se distinguen campos confirmados de semántica desconocida.
- Se documentan las reglas de opciones disponibles y su fuente/versión, o se declara que no hay reglas verificables.
- Se anotan límites conocidos del respaldo y de los binarios externos.

### PBG-02 — Definir matriz de permisos y política de alcance

**Objetivo:** precisar qué registros puede consultar y modificar cada rol.

**Criterios de aceptación:**

- La matriz define `agent`, `agency_owner` y `admin` para clientes, cotizaciones, citas, agencias y conversaciones.
- Se define el efecto de asignaciones vencidas, roles múltiples y cambios de agencia.
- Cada caso tiene resultado esperado (permitir/rechazar) y alcance.
- La política se refleja en `spec.md` o documento enlazado antes de implementarse.

## Fase 1 — Persistencia y autorización

### PBG-03 — Añadir migraciones para conversaciones, mensajes y acciones

**Depende de:** PBG-01.

**Objetivo:** persistir conversación y trazabilidad sin alterar el modelo original de negocio.

**Alcance:** tablas/migraciones para conversaciones, mensajes y auditoría de acciones; incluir propietario, cliente activo opcional, marcas de tiempo, estado y referencias de origen necesarias.

**Criterios de aceptación:**

- Las migraciones aplican sobre una base recién restaurada y siguen una convención repetible.
- Conversaciones y mensajes persisten con orden temporal estable.
- Cada acción registra actor, tipo e ID del registro, resultado y fecha; incluye conversación/clave idempotente cuando aplique.
- No se reemplazan ni alteran tablas originales de negocio.

### PBG-04 — Implementar autorización por registro

**Depende de:** PBG-01, PBG-02.

**Objetivo:** centralizar el alcance de la sesión y aplicarlo en lecturas y escrituras.

**Criterios de aceptación:**

- El backend deriva cuenta y rol de la sesión; ignora rol, propietario o agencia enviados por HTTP.
- Consultas de clientes, cotizaciones, citas y conversaciones filtran por alcance.
- La autorización se revalida para cada operación y dentro de la transacción de escritura.
- Accesos ajenos se rechazan sin exponer campos del recurso.
- Se cubren los casos definidos en PBG-02.

## Fase 2 — Conversación y consulta

### PBG-05 — Crear API de conversaciones e historial

**Depende de:** PBG-03, PBG-04.

**Objetivo:** crear, listar y recuperar conversaciones del usuario, y persistir mensajes.

**Criterios de aceptación:**

- Endpoints autenticados para crear/listar/recuperar conversación y guardar mensajes.
- Un usuario no puede recuperar conversación ajena por ID.
- Recuperar una conversación vuelve a validar el acceso al cliente asociado.
- La respuesta tiene esquema documentado y orden determinista de mensajes.

### PBG-06 — Implementar búsqueda y selección autorizada de clientes

**Depende de:** PBG-01, PBG-04, PBG-05.

**Objetivo:** encontrar y asociar un cliente permitido a la conversación.

**Criterios de aceptación:**

- La búsqueda devuelve solo clientes dentro del alcance de la sesión.
- La selección queda vinculada explícitamente a la conversación.
- Un cambio de cliente se registra y reemplaza el contexto activo.
- IDs de clientes ajenos se rechazan sin incluir sus datos.

### PBG-07 — Consultar perfil, notas y actividad con procedencia

**Depende de:** PBG-01, PBG-04, PBG-06.

**Objetivo:** responder consultas básicas sobre el expediente con datos locales.

**Criterios de aceptación:**

- El resumen usa solo campos confirmados y registros accesibles.
- Expone referencias verificables (IDs/tipo de fuente/fecha) ligadas al cliente activo.
- Reporta resultados vacíos y campos ausentes explícitamente.
- Cambiar de cliente no reutiliza referencias ni hechos del expediente anterior.

### PBG-08 — Consultar y comparar cotizaciones existentes

**Depende de:** PBG-01, PBG-04, PBG-06.

**Objetivo:** mostrar cotizaciones registradas y explicar qué falta para evaluar opciones.

**Criterios de aceptación:**

- Cotizaciones filtradas por cliente y alcance del usuario.
- Comparación limitada a datos presentes con fuentes visibles.
- Reglas disponibles ejecutadas en backend e identificadas por versión.
- Si faltan reglas o datos, se enumeran sin inventar precio, cobertura o aprobación.

## Fase 3 — Agenda transaccional

### PBG-09 — Consultar disponibilidad y resolver zonas horarias

**Depende de:** PBG-01, PBG-04.

**Objetivo:** normalizar horas solicitadas y calcular disponibilidad del agente.

**Criterios de aceptación:**

- La entrada incluye zona IANA y duración; se convierte en instantes absolutos antes de comparar.
- Horas ambiguas/inexistentes se rechazan o requieren aclaración.
- La lectura de disponibilidad respeta alcance y considera citas activas.
- La respuesta muestra fecha y hora en la zona elegida.

### PBG-10 — Gestionar citas con confirmación e idempotencia

**Depende de:** PBG-03, PBG-04, PBG-09.

**Objetivo:** guardar operaciones de agenda sin duplicados ni cruces concurrentes.

**Criterios de aceptación:**

- Antes de guardar se confirman cliente, agente, intervalo y zona horaria exactos.
- Una confirmación desactualizada no autoriza cambios en esos valores.
- PostgreSQL impide solapamientos de citas activas por agente bajo concurrencia.
- Reintento con la misma clave idempotente devuelve el resultado previo.
- Conflicto de horario no deja escritura parcial.
- Crear, modificar y cancelar deja auditoría con actor, registro y resultado.

## Fase 4 — Interfaz, integración y entrega

### PBG-11 — Construir interfaz de chat con contexto visible

**Depende de:** PBG-05, PBG-06, PBG-07, PBG-08.

**Objetivo:** integrar el chat conservando el estilo visual de la aplicación base.

**Criterios de aceptación:**

- La pantalla muestra historial, búsqueda/selección de clientes y cliente activo.
- Cambiar conversación o cliente no mezcla mensajes ni evidencia.
- Respuestas distinguen información encontrada y faltante y muestran fuentes.
- Estados de carga, vacío y error se entienden claramente.
- Sesión vencida vuelve al flujo de autenticación existente.

### PBG-12 — Añadir confirmación de agenda en el chat

**Depende de:** PBG-10, PBG-11.

**Objetivo:** revisar y confirmar cambios de cita desde la conversación.

**Criterios de aceptación:**

- Antes de una mutación, presentar resumen con valores exactos y acción solicitada.
- El usuario puede confirmar o cancelar la operación pendiente.
- Cambiar valores invalida la confirmación previa.
- La interfaz muestra resultado, conflicto y reintento de forma controlada.

### PBG-13 — Integrar proveedor de IA opcional tras herramientas controladas

**Depende de:** PBG-04, PBG-07, PBG-08. Puede omitirse para el MVP determinista.

**Objetivo:** mejorar la redacción sin entregar al modelo autoridad sobre datos o negocio.

**Criterios de aceptación:**

- El modelo recibe evidencia y resultados de reglas autorizados por el backend.
- Herramientas acotadas; cada llamada revalida identidad, alcance y argumentos.
- No hay secretos en el repositorio; configuración mediante variables de entorno.
- Proveedor/modelo, límites de datos y manejo de fallos quedan documentados.
- Fallo del proveedor produce error controlado, no una respuesta inventada.
- No se transmiten datos personales externamente sin autorización específica.

### PBG-14 — Preparar demo reproducible y documentar limitaciones

**Depende de:** PBG-05 a PBG-12; PBG-13 si se integra IA.

**Objetivo:** hacer verificable la entrega local de extremo a extremo.

**Criterios de aceptación:**

- Documentar arranque, cuenta local de prueba, flujo de demo y consultas para comprobar persistencia.
- La demo cubre conversación, expediente, cotizaciones, cita confirmada, idempotencia, conflicto y rechazo de acceso.
- Documentar sesión vencida, resultado vacío y fallo simulado del proveedor (si aplica).
- Enumerar datos/reglas/roles no confirmados y funcionalidades pendientes.
- Incluir instrucciones para ejecutar las comprobaciones existentes y mostrar el resultado.

## Orden sugerido del MVP

`PBG-01 → PBG-02 → PBG-03/PBG-04 → PBG-05 → PBG-06 → PBG-07/PBG-08 → PBG-09 → PBG-10 → PBG-11 → PBG-12 → PBG-14`.

PBG-13 es opcional para la primera entrega si el flujo determinista satisface el reto. Este archivo no crea issues externos ni asigna responsables.
