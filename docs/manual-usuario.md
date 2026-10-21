# Manual de usuario y guía de presentación

Cómo se usa el módulo de soporte con IA y cómo presentarlo. Primero va la preparación,
después las pantallas de cada rol, un guion de unos 20 minutos y las preguntas que es
probable que hagan.

Los pasos exactos de cada caso D1–D6 están en el README, en [Guion de demo](../README.md#guion-de-demo-d1d6).
Las pruebas para recorrer la app con calma están en [`pruebas-manuales.md`](pruebas-manuales.md).

## 1. El producto en tres frases

1. Un agente con un problema **escribe en un chat**. El asistente busca en el catálogo
   de problemas conocidos y, si hay solución, se la da con el artículo y le pregunta si
   se resolvió.
2. Si no hay solución, o la que dio no funcionó, **crea un ticket con el contexto ya
   ordenado**: el reporte original, un resumen, lo que se intentó y el enlace a la
   conversación. El agente sigue el ticket en «Mis tickets» y recibe avisos.
3. El **equipo de soporte** trabaja los tickets en una bandeja con estados, notas
   internas, adjuntos, métricas y un copiloto. La IA ayuda, pero **nunca decide
   permisos, identidad ni estados**: eso lo hace el backend.

## 2. Antes de presentar

**Un día antes:**
- [ ] `docker compose up -d --build` y `docker compose ps`: todo healthy.
- [ ] Haiku activo (README, «Activar el asistente con Haiku»). Mandar un mensaje de
  prueba: la primera respuesta tras arrancar tarda unos 18 s, las siguientes 1–6 s.
- [ ] `pnpm test:e2e` en verde (unos 3 minutos). Deja el backend otra vez con Haiku.
- [ ] No correr `pnpm test` (repo base) cerca de la demo: cierra la sesión de las
  cuentas de demo.

**Media hora antes:**
- [ ] Dos navegadores, o uno normal y otro de incógnito. Una cuenta por navegador.
- [ ] Pestañas abiertas: la app (http://localhost:8088), Mailpit (http://localhost:8025)
  y Swagger (http://localhost:8088/docs).
- [ ] Una terminal en la raíz del repo para D6.
- [ ] Iniciar sesión: `agente099` en el navegador A y `agente009` en el B.
- [ ] Tener a mano una imagen PNG chica y un archivo `.log` o `.txt` para adjuntar.
- [ ] Zoom del navegador al 110–125 % si se proyecta.

## 3. Roles y cuentas

Contraseña de todas: `123456`. Se entra con el alias o con el correo
(`agente099@reto.example`).

| Alias | Rol | Qué ve |
| --- | --- | --- |
| `agente099` | Solicitante (agente) | Soporte, sus tickets y sus notificaciones. Nada de otras personas |
| `agente009` | Admin | Todo: bandeja de tickets, catálogo, incidentes, métricas y prioridades |
| `agente105` | Admin | Segundo admin, para el conflicto de D6 y para asignaciones |
| `agente016` | Dueño de agencia | Como un solicitante más. **Ser dueño de la agencia no da acceso a los tickets de sus agentes** |
| `agente025` | Agente de la agencia de `agente016` | Igual: un compañero de agencia tampoco ve tickets ajenos |

`agente048`, `agente049`, `agente002`, `agente015` y `agente104` son de los tests
automáticos: no usarlas en la demo.

## 4. Pantallas del solicitante

### Soporte (`/soporte`)

El chat es la entrada al soporte.

- **Escribir el problema** como se lo contaría a un compañero. El asistente:
  - registra los datos del caso (área, qué intentaba hacer, qué esperaba, qué error vio
    y a quién afecta);
  - busca en el catálogo y, si encuentra algo, responde con los pasos y un enlace
    **Ver artículo**, marcado como **Ejemplo** porque el catálogo de la demo es
    ficticio;
  - pregunta **«¿Se resolvió tu problema?»**: **Sí, se resolvió** cierra la
    conversación como Resuelta; **No, sigue igual** hace que busque otra solución o
    cree el ticket;
  - si no hay artículo, hace como máximo dos preguntas útiles y crea el ticket.
- **Hablar con una persona**: crea el ticket enseguida, sin pasar por la IA.
- **Adjuntar una captura**: el asistente solo recibe el nombre, el tipo y el tamaño.
  Si se marca **Permitir que el asistente lea esta imagen** (desmarcada por defecto),
  el modelo la ve en ese turno.
- **Preguntas sobre mis cosas**: «¿cómo va mi ticket TCK-…?», «revisa el estado de mi
  cuenta», «agrega a mi ticket TCK-…: …» o «reabre mi ticket TCK-…». Lo que escribe
  datos aparece como **propuesta** con botones **Confirmar** y **Cancelar**: nada
  cambia hasta el clic de la persona.
- **Si la IA no responde**: aparece «El asistente no está disponible en este momento».
  El texto queda en el cuadro y el botón **Crear ticket con el formulario** sigue
  funcionando.

### Mis tickets (`/tickets`) y detalle

- La lista tiene pestañas por estado (Abierto, En revisión, Cerrado), búsqueda por
  número o texto, filtros, y marca de novedades sin leer.
- **Nuevo ticket** abre el formulario manual (título, descripción, categoría, impacto).
- El **detalle** muestra:
  - el número `TCK-000123` y el estado con su color (Abierto en azul, En revisión en
    dorado, Cerrado en verde);
  - el **Reporte original** del usuario, separado del **Resumen del asistente (IA)**;
  - el historial de comentarios y eventos, con adjuntos;
  - el cuadro para responder y adjuntar;
  - cuando está cerrado, la resolución y el botón **Reabrir ticket**, que pide
    **¿Qué pasó?**. El ticket vuelve a Abierto y se conserva todo el historial.

### Notificaciones

La **campana** de la barra superior muestra el contador. En `/notificaciones` está la
bandeja, con «Marcar todas como leídas». Hay avisos de:
- creación;
- cada cambio de estado (número, estado anterior y nuevo, fecha y enlace);
- respuestas del equipo y pedidos de información.

Los mismos avisos llegan por correo a Mailpit.

## 5. Pantallas del admin

### Bandeja de tickets (`/tickets`)

Además de los filtros del solicitante, el admin tiene: **Responsable** (yo, sin asignar o
un admin), **Antigüedad**, **Sin atender** y **En espera** (esperan al equipo o al
solicitante). Los enlaces del panel de métricas abren la bandeja con estos filtros.

### Detalle del ticket (vista de admin)

| Zona | Qué hace |
| --- | --- |
| Acciones de estado | **Pasar a En revisión** y **Cerrar ticket**. Cerrar desde En revisión pide el resumen de la resolución. Cerrar desde Abierto pide un motivo explícito, por ejemplo duplicado (con el ticket original) o reporte inválido |
| Panel lateral | Responsable (**Asignarme** o elegir un admin), prioridad, categoría, etiquetas e incidente conocido |
| Cuadro de respuesta | **Respuesta al solicitante** (pública) o **Nota interna** (solo la ve el equipo y no genera avisos). También **Pedir información al solicitante** |
| Copiloto | **Resumir caso** (usa todo, incluidas las notas internas) y **Sugerir respuesta** (nunca usa notas internas y se carga en el cuadro para editarla; no se envía sola). **Posibles duplicados** busca tickets abiertos parecidos sin usar IA |
| Entregas | Estado de cada aviso por canal (En la app / Correo): Pendiente, Entregada o Fallida, con **Reintentar** si falló |
| Conversación de origen | Enlace de solo lectura al chat que originó el ticket |
| Crear artículo desde este ticket | En un ticket resuelto, arma un borrador para el catálogo con los datos personales enmascarados y sin notas internas |
| Conflicto | Si otro admin cambió el ticket mientras tanto: «Otro administrador actualizó este ticket», con **Aplicar mi cambio sobre la versión nueva** |

### Catálogo (`/admin/catalogo`) e incidentes (`/admin/incidentes`)

- Artículos con versiones inmutables: se edita creando una versión nueva y se publica.
  Las respuestas del asistente guardan qué artículo y qué versión usaron.
- Estados: borrador, publicado y archivado. Un borrador que nunca se publicó se puede
  descartar; uno publicado solo se archiva.
- **Incidentes conocidos**: un problema general (por ejemplo, «Lentitud al cargar
  listados»). El asistente lo menciona cuando aplica y los tickets se pueden vincular.

### Métricas (`/admin/metricas`) y prioridades (`/admin/prioridades`)

- **Ahora mismo** (en vivo): sin atender, esperan al equipo, esperan al solicitante,
  antigüedad de lo pendiente, carga del equipo y salud del servicio (entregas fallidas,
  incidentes activos). Cada tarjeta muestra los 5 más antiguos y un enlace a la bandeja
  ya filtrada.
- **Por rango** (7, 30 o 90 días):
  - creados y cerrados por día;
  - tiempo de primera respuesta y de resolución (mediana, p90 y promedio);
  - tasa de reapertura;
  - cumplimiento de objetivos;
  - efectividad del asistente: resueltas sin ticket y artículos que no funcionaron;
  - **costo real de IA**, separado entre chat y copiloto.
- En **Prioridades** se configuran los objetivos de primera respuesta y resolución. El
  solicitante nunca ve objetivos ni plazos.

## 6. Guion de presentación (unos 20 minutos)

| Min | Bloque | Qué mostrar | Qué decir |
| --- | --- | --- | --- |
| 0–2 | Contexto | La pantalla de inicio de `agente099` | «El soporte empieza en un chat. La IA resuelve lo conocido y, si no puede, entrega al equipo un ticket con el contexto ya ordenado.» |
| 2–5 | **D1** | Soporte → problema de inicio de sesión → artículo → **Sí, se resolvió** | «Respondió desde el catálogo y no inventó: el artículo tiene enlace, versión y la marca de Ejemplo. No se creó un ticket innecesario.» |
| 5–8 | **D2** | Problema sin artículo → una pregunta → tarjeta TCK → abrir el ticket | «El número y el enlace los pone el backend, no el texto del modelo. El reporte original se guarda separado del resumen de la IA. Si se reintenta el mensaje, no se duplica: cada intención lleva su Idempotency-Key.» |
| 8–12 | **D3** | `agente099` cierra sesión. `agente009`: En revisión → respuesta → nota interna con `.log` → imagen pública → Cerrar. Volver como `agente099` y abrir Mailpit | «El cambio de estado, el evento, la notificación y el job del correo se guardan en la misma transacción. Si algo falla, no queda nada a medias. El solicitante no estaba conectado y los avisos lo esperaron.» |
| 12–14 | **D4** | `agente099` reabre con motivo y responde | «El historial queda completo. La nota interna y su adjunto nunca le llegan: se filtran en la consulta, no en la pantalla.» |
| 14–16 | **D5** | `agente016` abre la URL del ticket y la del adjunto. En su chat, la instrucción maliciosa | «Un recurso ajeno responde 404, no 403, para no revelar que existe. El dueño de la agencia no tiene acceso. El modelo no tiene herramientas para cerrar ni para ver datos de otros: aunque lo intente, no puede.» |
| 16–19 | **D6** | (a) `AI_FAKE_FAILURE=true docker compose up -d backend` y escribir en Soporte. (b) `docker compose stop mailpit`, cambiar un estado, ver **Entregas** y `start`. (c) Dos admins sobre el mismo ticket | «El soporte no depende de la IA. Los correos se reintentan con backoff y se entregan una vez. Dos admins no se pisan: el segundo ve el conflicto y decide.» |
| 19–20 | Cierre | Métricas → costo de IA. Swagger `/docs` | «Cada respuesta guarda sus tokens: el costo real ronda medio milésimo de dólar por mensaje. Todo está documentado en OpenAPI y cubierto por tests.» |

**Después de D6a**, volver a la IA real con `docker compose up -d backend`.

**Si queda tiempo**, mostrar:
- el copiloto (**Resumir caso** y **Sugerir respuesta**) en un ticket con varios
  comentarios;
- una propuesta del asistente: «agrega a mi ticket TCK-…: uso Chrome» → **Confirmar**;
- la visión: adjuntar una captura con el consentimiento marcado;
- **Crear artículo desde este ticket** en uno resuelto.

## 7. La IA: qué hace y cómo está protegida

| Pregunta | Respuesta corta |
| --- | --- |
| ¿Qué modelo? | `claude-haiku-5-5` de Anthropic, con `effort: low`. Es el más barato y alcanza: la tarea es buscar, seguir reglas y llamar herramientas. Las decisiones críticas no las toma el modelo |
| ¿Tiene acceso a la base? | **No.** Solo puede llamar 8 herramientas que valida el servidor con zod. Cada herramienta consulta con la sesión de la persona, así que solo ve lo suyo |
| ¿Qué herramientas? | `search_articles`, `get_article`, `update_case_details`, `create_ticket`, `get_my_tickets`, `get_my_account_status`, `propose_comment_on_my_ticket` y `propose_reopen_my_ticket`. Ninguna cambia estados ni cierra |
| ¿Puede crear tickets a nombre de otro? | No. El solicitante sale de la sesión; el esquema de la herramienta rechaza campos extra |
| ¿Y si alguien le dice «soy admin»? | No cambia nada: el rol se lee de la base en cada request. Los mensajes, artículos y adjuntos se tratan como datos, no como instrucciones |
| ¿Qué datos recibe? | La conversación de la propia persona, los artículos publicados (ficticios), los datos públicos de sus tickets y los metadatos de sus adjuntos. **Nunca** notas internas, datos de otras personas ni secretos (se enmascaran) |
| ¿Puede escribir datos? | Solo propone. La persona confirma con un clic y el backend ejecuta con su sesión, con los mismos permisos y eventos que si lo hiciera a mano |
| ¿Y si se cae? | El mensaje queda guardado y el chat ofrece el formulario. Todo lo demás (tickets, avisos, bandeja) sigue igual |
| ¿Cuánto cuesta? | ≈ US$0.00055 por mensaje, medido. Con US$5 alcanzan unas 800 conversaciones. Proyección por número de clientes en `costos-ia.md` |

Más detalle en [`asistente.md`](asistente.md) y en el ADR 0003.

## 8. Arquitectura en una diapositiva

```text
 Navegador ──► nginx (:8088) ──/api──► API Fastify (:8008) ──► PostgreSQL 16
   React 19       CSP con nonce          │   esquema helpdesk          ▲
                                         │   (migraciones)             │ outbox + jobs
                                         ├──► S3 privado (adjuntos)    │ SKIP LOCKED
                                         └──► Anthropic (Haiku)        │
                                                                Worker ┴──► Mailpit (correo)
```

- **Monolito modular** en un workspace de pnpm: `backend`, `frontend` y
  `packages/shared` con los esquemas zod que usan los dos lados.
- **Capas por módulo:** `routes` (HTTP), `service` (reglas y permisos), `repository`
  (SQL parametrizado, siempre filtrado por el actor).
- **Todo lo nuevo vive en el esquema `helpdesk`.** No se tocó ningún esquema original
  ni el contrato de login.
- **Worker propio sobre PostgreSQL** (`FOR UPDATE SKIP LOCKED`): reintentos con
  backoff, sin Redis ni RabbitMQ. La comparación está en
  [`despliegue-y-escalabilidad.md`](despliegue-y-escalabilidad.md).
- **Adjuntos:** bucket privado; la API autoriza cada descarga y la sirve por streaming.
  Se valida el contenido real del archivo, no solo la extensión.

## 9. Calidad

| Qué | Dónde |
| --- | --- |
| Tests de integración con tres actores por endpoint (dueño, otro usuario y admin) | `backend/test/`, `pnpm test:unit` |
| Los seis casos del PDF de punta a punta | `tests/e2e/`, `pnpm test:e2e` |
| Matriz de permisos con el test de cada fila | [`permisos.md`](permisos.md) |
| Contratos de la API | Swagger en `/docs`, guía en [`api.md`](api.md) |
| Decisiones | `docs/adr/0001` a `0005` |
| Specs con criterios Given/When/Then y trazabilidad con el PDF | `specs/` |

## 10. Preguntas probables

**¿Por qué 404 y no 403 en un ticket ajeno?**
Un 403 confirmaría que el ticket existe. Con 404, quien prueba números al azar no
aprende nada.

**¿Por qué no se reutilizó el esquema `support` que ya existía?**
Viene de SQLite: fechas en `bigint`, JSON como texto y `rowid`. Además, un test del repo
base exige que sus conteos no cambien. Ver ADR 0001.

**¿Por qué no URLs firmadas de S3 para los adjuntos?**
Con streaming desde la API, cada descarga se autoriza en el momento: un enlace
compartido no sirve a otra persona, y retirar un adjunto corta el acceso enseguida.
Además, la CSP y el host interno de S3 impedirían usarlas. Ver ADR 0004.

**¿Por qué un worker propio y no Redis o RabbitMQ?**
El job se guarda en la misma transacción que el cambio del ticket. No hay infraestructura
extra y el volumen de un soporte interno es bajo. Si creciera a cientos de jobs por
segundo, se cambia el transporte y se mantiene el outbox. Ver
[`despliegue-y-escalabilidad.md`](despliegue-y-escalabilidad.md) §4.

**¿Se pueden duplicar los correos?**
La política es *at-least-once*: si el worker muere justo después de enviar, el correo se
repite con el mismo `Message-ID` y los clientes de correo lo agrupan. Las notificaciones
en la app no se duplican: hay una por evento y destinatario.

**¿Qué pasa si dos admins cambian lo mismo?**
Concurrencia optimista: cada cambio envía su `version`. El primero gana. El segundo
recibe 409 con el ticket actual y decide si aplica su cambio sobre la versión nueva.

**¿Cuánto aguanta?**
Una VM con compose alcanza para unos 1.000–2.000 usuarios conectados a la vez. Para más:
varias instancias de la API, el rate limit en Redis, PgBouncer y SSE en lugar de polling.
Ver [`despliegue-y-escalabilidad.md`](despliegue-y-escalabilidad.md) §3.

**¿Dónde lo desplegarías?**
Para un piloto, una VM con el mismo compose y TLS. Para producción, AWS: ECS Fargate,
RDS, S3 y SES, sin cambiar el código.

**¿Qué quedó fuera?**
Tiempo real por SSE (hoy hay polling cada 20 s), un proveedor de correo real, antivirus
para adjuntos, preferencias de notificación, fusionar duplicados, horario laboral en las
métricas, y MCP y embeddings (ver ADR 0005). La lista completa está en
`specs/BACKLOG.md`.

**¿Los datos de la demo son reales?**
No. La base es una réplica con datos personales reales, pero **ningún dato de esas
tablas** se copió a seeds, tests, documentos ni prompts. Los artículos, incidentes y
tickets de la demo son ficticios y están marcados como ejemplo.

## 11. Si algo sale mal durante la demo

| Síntoma | Qué hacer |
| --- | --- |
| «Origen no permitido» al entrar | Abrir la app desde `http://localhost:8088` (la URL debe estar en `APP_ORIGIN`) |
| Me sacó de la sesión | Se entró con la misma cuenta en otra ventana: hay una sesión por cuenta. Volver a entrar |
| «Demasiados intentos» al iniciar sesión | Límite de 15 logins por minuto. Esperar un minuto |
| El asistente tarda mucho la primera vez | Es la compilación de esquemas tras arrancar (≈ 18 s). Mandar un mensaje de prueba antes de presentar |
| El asistente no responde | Ver que D6a no quedó activo: `docker compose up -d backend`. Si sigue, usar **Crear ticket con el formulario**, que es justamente el plan B |
| No llegan correos | `docker compose ps`: Mailpit y el worker deben estar arriba. Si Mailpit estuvo detenido, el reintento llega en menos de un minuto |
| El backend quedó con el asistente simulado tras `pnpm test:e2e` | `docker compose up -d backend worker` |
