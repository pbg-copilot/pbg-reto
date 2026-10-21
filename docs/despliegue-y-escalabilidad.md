# Despliegue y escalabilidad

Dónde se podría desplegar este stack, qué recomiendo y qué habría que cambiar a medida
que crece el uso. Nada de esto está desplegado: el reto se entrega por PR y corre en
local con Docker Compose.

## 1. Qué hay que desplegar

| Pieza | Hoy (compose) | Necesita |
| --- | --- | --- |
| `frontend` | nginx con el build de Vite | Servir estáticos, reenviar `/api` a la API y **reemplazar el nonce de la CSP** en cada respuesta (`sub_filter`) |
| `backend` | Fastify en Node 24 | Proceso HTTP sin estado. Sesiones, idempotencia y colas están en PostgreSQL |
| `worker` | El mismo código, otro proceso | **Siempre encendido**: consulta `helpdesk.jobs` cada `WORKER_POLL_MS` (1 s) |
| `postgres` | PostgreSQL 16 | Extensiones `unaccent` y `pg_trgm` |
| `s3` | RustFS | Cualquier S3 compatible con un bucket privado |
| `mailpit` | Buzón local | En producción, un proveedor SMTP real (SES, Postmark, Resend…) |

Dos detalles condicionan dónde se puede desplegar:

1. **El worker es un proceso largo.** Las plataformas *serverless* que apagan el proceso
   entre requests (Vercel Functions, Lambda sin más) no sirven para él tal como está.
2. **La CSP usa un nonce por respuesta, que pone nginx.** Un hosting de estáticos puro
   (Vercel, Netlify, S3 + CloudFront) no lo hace sin un middleware en el edge. Lo más
   simple es desplegar la imagen de `frontend` tal cual.

## 2. Opciones

| Opción | Cómo queda | A favor | En contra | Para |
| --- | --- | --- | --- | --- |
| **Una VM con Docker Compose** (Hetzner, DigitalOcean, Lightsail, EC2) | El mismo `compose.yaml` con Caddy o Traefik delante para TLS, y backups de Postgres a un bucket | Cambio mínimo; barato; se depura igual que en local | Una sola máquina: hay que ocuparse de backups, actualizaciones y monitoreo | Demo, piloto, uso interno de cientos a algunos miles de agentes |
| **PaaS con contenedores** (Render, Railway, Fly.io) | Tres servicios (web, api, worker) desde los mismos Dockerfiles, Postgres gestionado y un bucket S3 | TLS, despliegues y backups resueltos; poco trabajo de operación | Menos control de red; el costo sube más rápido con el tamaño | Un MVP en producción sin equipo de infraestructura |
| **AWS gestionado** | ECS Fargate (web, api, worker) + RDS PostgreSQL 16 + S3 + SES + ALB, secretos en Secrets Manager, logs en CloudWatch | Escala horizontal, alta disponibilidad multi-AZ, cumplimiento | Más piezas y más configuración (VPC, IAM) | Producción real con datos de clientes |
| **GCP gestionado** | Cloud Run (web y api), el worker en Cloud Run con CPU siempre asignada o en GKE, Cloud SQL, GCS con interoperabilidad S3 | Cloud Run escala a cero la parte web | El worker no encaja en el modelo de Cloud Run por defecto | Si la empresa ya está en GCP |

### Recomendación

- **Para el piloto: una VM con Docker Compose.** Es exactamente lo que ya funciona en
  local y alcanza de sobra para el volumen esperado (ver la sección 3). Hay que sumar:
  TLS con Caddy, `pg_dump` diario a un bucket, actualizaciones del sistema y un monitor
  de `/health`.
- **Para producción: AWS con ECS Fargate + RDS + S3 + SES.** Ninguna pieza del código
  cambia:
  - S3 reemplaza a RustFS con las mismas variables (`S3_ENDPOINT`, `S3_BUCKET`…).
  - SES reemplaza a Mailpit por SMTP.
  - RDS soporta `unaccent` y `pg_trgm`.

  Lo que sí cambia es la configuración:
  - `MAIL_ALLOWED_DOMAINS` deja de ser `reto.example`;
  - `ANTHROPIC_API_KEY` sale de Secrets Manager;
  - el login local del reto (`reto.sessions`) se reemplaza por la autenticación real de
    PBG.

Antes de cualquier despliegue fuera de local:
- **No desplegar la réplica con datos personales reales** (`data/postgres/`). Producción
  usa la base real de PBG, con el esquema `helpdesk` creado por las migraciones.
- Configurar `APP_ORIGIN` y `PUBLIC_APP_URL` con el dominio real.
- Activar HTTPS y poner `PUBLIC_APP_URL` con `https://`: así la cookie de sesión sale
  con `Secure` (`backend/src/app.ts`).

## 3. Cuándo escalar

### Cuánta carga genera un usuario

Con la app abierta, el navegador consulta la API de forma periódica:

| Consulta | Cada |
| --- | --- |
| Contador de notificaciones | 20 s |
| Lista o detalle del ticket abierto | 30 s |
| Sesión | 60 s |
| Entregas pendientes (solo admin, con un correo pendiente) | 5 s |

Son unas **0,1 requests por segundo por pestaña activa**. TanStack Query no consulta en
pestañas ocultas. Cada consulta es una lectura indexada de pocos milisegundos: con 20.000
tickets, todas las consultas del panel tardan menos de 20 ms (medido con `EXPLAIN
ANALYZE` dentro de una transacción revertida; ver `docs/pruebas-manuales.md` §10).

El chat pesa distinto: cada mensaje espera al modelo entre 1 y 6 segundos. Es espera de
red, no CPU, así que Node la atiende bien. El límite real lo ponen los tokens por minuto
de la cuenta de Anthropic.

### Escalones

| Usuarios conectados a la vez | Requests/s aprox. | Qué hacer |
| --- | --- | --- |
| Hasta ~1.000–2.000 | ~100–200 | **Nada.** Una VM de 2–4 vCPU con todo en compose. Es el rango esperado para el soporte interno de una red de agencias |
| ~2.000–10.000 | ~200–1.000 | Escalar horizontalmente la API (ver abajo). Postgres gestionado con más CPU |
| Más de ~10.000 | > 1.000 | Cambios de arquitectura: tiempo real, colas externas, réplicas de lectura |

Son órdenes de magnitud para planificar, no un benchmark. Antes de cada escalón conviene
una prueba de carga (k6 o autocannon) con el uso real.

### Qué cambiar en cada escalón

**De 2.000 a 10.000 usuarios a la vez:**

1. **Varias instancias de la API detrás de un balanceador.** La API ya no guarda estado
   en memoria, salvo una cosa:
   - el rate limit (`@fastify/rate-limit`) cuenta en la memoria de cada instancia. Con
     N instancias, el límite efectivo es N veces mayor. Hay que pasarlo a Redis (el
     plugin lo soporta con la opción `redis`).
2. **PgBouncer o RDS Proxy.** Cada proceso abre hasta 10 conexiones (`backend/src/db.ts`).
   Con 6 instancias de API y 2 workers ya son 80, cerca del límite por defecto de
   PostgreSQL.
3. **Tiempo real en lugar de polling.** Reemplazar las consultas de 20–30 s por
   Server-Sent Events para notificaciones y cambios de tickets. Reduce las requests y
   los avisos llegan al instante. Con varias instancias, el evento se reparte con
   `LISTEN/NOTIFY` de Postgres o con Redis pub/sub.
4. **CDN delante de los estáticos** y caché de larga duración para los archivos con hash
   de Vite.
5. **Proveedores reales:** S3 y SES, con los avisos de rebote de SES conectados a la
   tabla de entregas.
6. **Varios workers.** Ya funciona sin cambios: `FOR UPDATE SKIP LOCKED` garantiza que
   dos workers nunca toman el mismo job.

**Más de 10.000 usuarios a la vez:**

1. **Cola externa si el volumen de jobs lo pide** (SQS, BullMQ sobre Redis o RabbitMQ).
   La señal es sostener cientos de jobs por segundo, o que otros servicios necesiten
   consumir los mismos eventos. Se mantiene la tabla outbox: la transacción del ticket
   escribe el evento y un publicador lo pasa a la cola. Así no se pierde la garantía
   transaccional. Ver la sección 4.
2. **Réplicas de lectura** para la bandeja, la búsqueda y las métricas.
3. **Agregados precalculados para las métricas** (vistas materializadas o una tabla por
   día que actualiza el worker), en lugar de calcular sobre todos los tickets del rango.
4. **Archivado y limpieza:** mover a frío los tickets cerrados hace más de N meses y
   purgar las notificaciones leídas viejas, las claves de idempotencia vencidas y los
   jobs terminados.
5. **Búsqueda dedicada** (OpenSearch o embeddings con pgvector) si el catálogo pasa de
   miles de artículos. Ver `docs/adr/0005-ai-capabilities-roadmap.md`.
6. **Observabilidad:** métricas y trazas con OpenTelemetry, alertas de latencia, de
   errores 5xx, de la cola de jobs y de entregas fallidas.
7. **IA:** subir el nivel de la cuenta de Anthropic, poner alertas de presupuesto y
   limitar el gasto por usuario. El costo por cliente está en `docs/costos-ia.md`.

## 4. El worker frente a Redis o RabbitMQ

El worker (`backend/src/worker.ts` y `backend/src/jobs/`) es código propio, sin librerías
de colas. Usa una función que **ya trae PostgreSQL**: `SELECT … FOR UPDATE SKIP LOCKED`.
Cada worker toma los jobs pendientes que nadie tiene bloqueados, los procesa y los marca
como `delivered`, o los reprograma con backoff (10 s, 20 s, 40 s…).

| | Worker sobre PostgreSQL (hoy) | Redis + BullMQ | RabbitMQ |
| --- | --- | --- | --- |
| Infraestructura extra | Ninguna | Un Redis con persistencia configurada | Un broker que hay que operar |
| Garantía transaccional | **Sí.** El job se guarda en la misma transacción que el cambio del ticket. Si el cambio falla, no hay job; si el job falla, no hay cambio | No. Escribir en la base y en Redis son dos operaciones: si una falla, quedan inconsistentes. Hace falta un outbox de todas formas | Igual que Redis |
| Latencia | Hasta `WORKER_POLL_MS` (1 s) | Milisegundos (push) | Milisegundos (push) |
| Volumen | Decenas a cientos de jobs por segundo | Miles por segundo | Miles por segundo, con enrutamiento entre servicios |
| Visibilidad | Una consulta SQL muestra qué está pendiente, fallido y por qué | Necesita un panel (Bull Board) | Consola de RabbitMQ |
| Funciones | Reintentos con backoff, deduplicación, estado por canal | Prioridades, cron, rate limit por cola, flujos | Colas de mensajes muertos, enrutamiento, acks, varios consumidores |
| Mantenimiento | Lo mantenemos nosotros (~230 líneas, con tests en `jobs.test.ts`) | Librería madura | Infraestructura madura |

**Por qué este diseño para el reto:**
- El PDF pide que los avisos no se pierdan ni se dupliquen. El outbox en la misma
  transacción lo resuelve sin piezas extra.
- El volumen de un soporte interno es de pocos jobs por minuto.
- Una cola externa sumaría un servicio más y el problema de la doble escritura.

**Cuándo cambiar:**
- **pg-boss o graphile-worker** son el punto intermedio: siguen sobre PostgreSQL, con
  `LISTEN/NOTIFY` para no esperar el polling, y con cron y panel incluidos.
- **Redis/BullMQ o SQS** cuando haya cientos de jobs por segundo sostenidos o el polling
  pese en la base.
- **RabbitMQ o Kafka** cuando varios servicios consuman los mismos eventos.

En todos los casos se mantiene la tabla outbox como origen de los eventos.
