# RETO

Frontend React y TypeScript, API Fastify y TypeScript, y PostgreSQL 16.
La interfaz usa la paleta azul petróleo, la palabra RETO, el nombre del agente
conectado y un menú de cuenta que contiene únicamente Logout.

## Iniciar

Requisitos: Docker Desktop o Docker Engine con Compose v2. Ejecutar desde la raíz:

```sh
docker compose up -d --build
```

En el primer arranque PostgreSQL verifica los checksums y restaura automáticamente
los esquemas originales, los registros, índices, constraints, triggers y secuencias
del respaldo incluido en `data/postgres/`. Después la API prepara la autenticación
local. No se necesita acceso a AWS. La primera carga requiere varios minutos.
Los siguientes arranques conservan los datos y cambios locales.

| Servicio | Dirección |
| --- | --- |
| Aplicación | http://localhost:8088 |
| API | http://localhost:8008 |
| Health | http://localhost:8008/health |
| PostgreSQL | localhost:5439, base `reto`, usuario `reto`, contraseña `reto_local_only` |

Los puertos se publican solo en loopback. Las opciones están en `.env.example`.
Si se cambia el puerto web o el host, actualizar también `APP_ORIGIN`.

### Soporte y tickets con IA: servicios adicionales

| Servicio | Dirección | Uso |
| --- | --- | --- |
| Documentación de la API | http://localhost:8088/docs | OpenAPI (Swagger UI). JSON en `/docs/json` |
| Worker | sin puerto | Procesa trabajos persistentes (correos, reintentos) |
| Mailpit | http://localhost:8025 | Buzón local: muestra los correos de notificación; no envía nada real |
| S3 local (RustFS) | http://localhost:9001 | Bucket privado `reto-attachments` para adjuntos; usuario `reto` / `reto_local_only` |

- Al arrancar, la API aplica las migraciones del esquema `helpdesk` y carga los datos
  de ejemplo de forma idempotente. No modifica los esquemas originales
  (`docs/adr/0001`).
- La app llama a la API bajo `/api/…`. nginx quita el prefijo, de modo que las rutas
  de la API son las del enunciado (`/tickets`, `/support/...`). `/auth`, `/health` y
  `/docs` siguen disponibles sin prefijo.
- Sin `ANTHROPIC_API_KEY`, el asistente usa un proveedor simulado y la app funciona
  igual. Con key: `AI_PROVIDER=anthropic` y `AI_MODEL=claude-haiku-5-5` en `.env`.
  Costos estimados en `docs/costos-ia.md`.

### Desarrollo con pnpm

Requisitos: Node 24 y pnpm 11 (`npm i -g pnpm@11.21.0`, o `corepack enable`).

```sh
cp .env.example .env
pnpm install
docker compose up -d postgres s3 mailpit   # infraestructura
pnpm dev                                    # API :8008, worker y web :5173 con recarga en caliente
```

Para usar `pnpm dev` hay que detener los contenedores `backend`, `worker` y
`frontend` (`docker compose stop backend worker frontend`), porque comparten el
puerto 8008.

| Comando | Qué hace |
| --- | --- |
| `pnpm typecheck` · `pnpm lint` | Tipos y lint de todo el workspace |
| `pnpm test` | Pruebas del repo base (API, datos y base dentro del contenedor) |
| `pnpm test:unit` | Pruebas de la API con Vitest (`app.inject`) contra el Postgres de compose |
| `pnpm test:ui` | Pruebas de interfaz con Playwright contra :8088 |
| `pnpm db:migrate` | Aplica las migraciones pendientes |

Las pruebas automáticas usan cuentas reservadas (`agente048`, `agente049`,
`agente002`, `agente015`, `agente104`). Como hay una sola sesión activa por cuenta,
no cierran la sesión de las cuentas de demo. Excepción: `pnpm test` (del repo base)
inicia y cierra sesión con `agente099`, `agente009` y `agente016`.

### Problemas frecuentes

- **"Origen no permitido" al iniciar sesión.** La URL desde la que se abre la app
  debe estar en `APP_ORIGIN`, por ejemplo `http://localhost:8088,http://localhost:5173`.
- **Dos usuarios a la vez.** Hay una sola cookie por navegador y una sesión por cuenta.
  Para probar admin y solicitante juntos, usar dos navegadores o una ventana de
  incógnito.
- **La primera restauración tarda.** El healthcheck de PostgreSQL espera hasta 15
  minutos antes de marcar error. Seguir el avance con `docker compose logs -f postgres`.

Las pruebas manuales paso a paso, con las cuentas para cada una, están en
[`docs/pruebas-manuales.md`](docs/pruebas-manuales.md).

### Métricas de atención

En `/admin/metricas` (solo admin) se ven los tickets **creados** en el rango (7, 30 o 90
días), en tiempo calendario y en UTC. Los objetivos se configuran en `/admin/prioridades`.

| Métrica | Fórmula |
| --- | --- |
| Primera respuesta (TPR) | Primer comentario **público** de un admin − creación. Las notas internas, la asignación y los cambios de estado no cuentan. No se recalcula al reabrir |
| Resolución (TR) | Último cierre como «Resuelto» − creación. Reabrir alarga el TR; los cierres por otros motivos no cuentan |
| Sin atender | Abiertos sin respuesta pública del equipo |
| Tasa de reapertura | Tickets reabiertos al menos una vez / tickets resueltos |
| Cumplimiento | % de tickets con TPR (o TR) dentro del objetivo de su prioridad. Sin objetivo: «Sin objetivo definido». El solicitante nunca ve objetivos ni plazos |
| Costo de IA | Tokens guardados del chat y del copiloto × precio del modelo |

Los tiempos se muestran como mediana y p90, que son robustos ante casos extremos, y
también como promedio.

### Adjuntos y evidencias

| Regla | Valor |
| --- | --- |
| Tipos admitidos | PNG, JPEG, WEBP, GIF, PDF y texto (`.txt`, `.log`) |
| Rechazados | Todo lo demás, por ejemplo SVG, HTML, XML, ejecutables, comprimidos y Office |
| Tamaño | 10 MB por archivo, hasta 5 por envío (`UPLOAD_MAX_BYTES`, `UPLOAD_MAX_FILES`) |
| Validación | En el servidor, por el contenido (magic bytes con `file-type`), que debe coincidir con la extensión. El texto debe ser UTF-8 sin bytes nulos. Se guarda el SHA-256 |
| Errores | 415 si el tipo no se admite o no coincide; 413 si pasa el tamaño. Nada rechazado llega al bucket |
| Almacenamiento | Metadatos en PostgreSQL. El binario va al bucket S3 privado con clave `t/<ticket>/<uuid>` o `c/<conversación>/<uuid>`, sin el nombre original |
| Descarga | `GET /attachments/:id/download`, que autoriza cada request y hace streaming. Usa `Content-Disposition: attachment`, `nosniff` y `Cache-Control: private, no-store`. Las imágenes admiten `?inline=1` para la vista previa |
| Visibilidad | El solicitante solo ve y descarga los públicos de sus tickets y chats. Un adjunto de una nota interna es interno y nunca aparece para el solicitante. Uno ajeno o interno da 404 |
| Retiro | Solo un admin, con motivo. El archivo deja de servirse y quedan el registro y el evento con autor, fecha y motivo; el binario se conserva para auditoría |
| Asistente | Solo recibe nombre, tipo y tamaño. Las imágenes del chat le llegan si la persona marca «Permitir que el asistente lea esta imagen», que está **desmarcada** por defecto |
| Pendiente | Antivirus (ClamAV) y purga automática de binarios retirados |

### Notificaciones

- **Qué se avisa.**
  - Al solicitante: la creación, cada cambio de estado (número, estado anterior,
    estado nuevo, fecha y enlace), las respuestas públicas del equipo, las
    solicitudes de información y las reaperturas.
  - Al equipo: cuando el solicitante responde o reabre (al responsable, o a todos
    los admins si no hay responsable) y cuando a alguien le asignan un ticket.
  - Las notas internas no generan avisos al solicitante, y su texto nunca aparece en
    una notificación.
- **Transaccional (outbox).** La notificación, su entrega y el job del correo se
  guardan en la misma transacción que el cambio del ticket. Si el cambio falla, no
  queda ningún aviso. Si el aviso falla, se revierte el cambio.
- **Bandeja.**
  - La campana consulta el contador cada 20 s y al volver a la pestaña. El tiempo
    real por SSE queda como mejora.
  - Las notificaciones persisten: quien no estaba conectado las ve al entrar.
  - Al abrir una, la API vuelve a verificar el permiso sobre el ticket.
- **Correo.**
  - Lo envía el worker a **Mailpit** (http://localhost:8025): un buzón local que no
    envía nada a internet.
  - Solo se escribe a los dominios de `MAIL_ALLOWED_DOMAINS` (`reto.example`).
  - Reintentos con backoff de 10, 20, 40, 80 y 160 s (6 intentos). Agotados, la
    entrega queda **Fallida** y un admin puede reintentarla desde el panel
    «Entregas» del ticket.
- **Idempotencia y duplicados.**
  - Una notificación por evento y destinatario (`dedupe_key`), y un job por entrega.
  - La política es *at-least-once*: si el worker muere justo después de enviar,
    el correo se repite con el mismo `Message-ID`, y los clientes de correo lo
    agrupan.

## Usuarios de prueba recomendados

Todos los usuarios locales usan **`123456`**. Se puede iniciar sesión con el
correo o con el alias, por ejemplo `agente099`. Los alias y correos se conservan
entre la primera versión y esta copia completa; los nombres ahora son los del
respaldo original, según la instrucción de Abel.

| Perfil | Correo | Rol |
| --- | --- | --- |
| Gonzalo Humberto Davila, agente con muchos clientes | `agente099@reto.example` | `agent` |
| Natalia Sierra Saleh, administradora | `agente009@reto.example` | `admin` |
| Juan Francisco Gavilanes, dueño de Domani | `agente016@reto.example` | `agency_owner` |

`agente067@reto.example` corresponde a Marlene San Fiel, dueña de San Fiel
Insurance LLC, y conserva también `agency_owner`. No corresponde a Juan de Domani.

Los cuatro dueños conservan `accounts.role = 'agency_owner'`, `accounts.agency_id`
y su vínculo en `agencies.owner_account_id`. También se conservan `appeal_officer`,
`admin`, los roles de asiento y las relaciones de líderes y miembros de equipos.
`data/test-users.json` enumera los 107 alias, correos, IDs sustituidos y roles.
La pantalla inicial sigue siendo la base del reto; el dashboard de agencia y los
reportes se implementarán sobre estos datos.

## Datos y estructura

Esta versión reemplaza el modelo reducido `reto.clients`, las cotizaciones
simuladas y las identidades ficticias de la entrega inicial. Restaura los
**esquemas y tablas originales** de PostgreSQL. `data/manifest.json` registra
la fecha y checksum del respaldo AWS, cada tabla y columna, los conteos originales
y exportados y los checksums de las partes distribuidas.

El respaldo del 20 de octubre de 2026 contiene 182 tablas y 351.429 registros.
La copia distribuye 350.217 registros; los 1.212 restantes corresponden a las
exclusiones de seguridad indicadas abajo.

Incluye cuentas, agencias, perfiles, licencias, clientes, cotizaciones, agenda,
llamadas, transcripciones, coaching, actividad, facturación, soporte y operaciones.
Los documentos flexibles conservan su estructura original en columnas JSON/JSONB
y texto; por ejemplo, los libros de clientes están en
`public.pbg_state_documents`, como en la base AWS. No se trasladan a un modelo
inventado ni se sustituye su contenido de negocio por datos simulados.

Por instrucción expresa de Abel se sustituyen **correos, IDs de negocio y teléfonos**.
El mapeo consistente mantiene sus referencias entre tablas, documentos JSON, claves
dinámicas y rutas. Los correos usan `reto.example` y los teléfonos el prefijo no
rutable `+999`. Los enteros técnicos y las claves naturales de calendario se
conservan; las fechas de negocio mantienen su valor y tipo originales.

**Esta copia contiene datos personales reales:** nombres, direcciones, fechas de
nacimiento, NPN/licencias, información de solicitudes, notas y transcripciones.
También conserva importes, fechas, estados y relaciones originales. Debe permanecer
en el repositorio y entorno de trabajo autorizados.

Se mantienen las tablas de autenticación originales, vacías de sesiones, OTPs,
restablecimientos y credenciales WebRTC. Tampoco se distribuyen valores originales
de secretos o hashes de contraseñas. Las contraseñas locales de cuentas, operadores
y usuarios de operaciones se reemplazan por `123456`, almacenadas con scrypt.
`public.pbg_import_originals` conserva su estructura pero no sus valores originales.
Estas excepciones están enumeradas en el manifiesto.

Los payloads cifrados que se pueden abrir con la clave privada disponible se
procesan y vuelven a cifrar con la clave exclusivamente local de
`data/local-compliance-key.txt`, manteniendo el formato AES-256-GCM `v1.iv.cipher`.
Los cifrados históricos cuya clave no está disponible se conservan como bytes
opacos originales; el manifiesto indica su cantidad. Las claves de producción y
el mapeo privado nunca se incluyen.

El respaldo de PostgreSQL contiene metadatos y referencias de medios. Los objetos
binarios de S3/R2 permanecen fuera de esta entrega; sus rutas incluyen los IDs
sustituidos y no constituyen enlaces funcionales a los documentos de producción.

La fuente es el respaldo AWS indicado en el manifiesto, con su propia fecha de
corte. No es una sincronización continua de producción. La aplicación del reto no
se conecta a los servicios de producción ni ejecuta llamadas, correos o cobros.

## Consultar la base

```sh
docker compose exec postgres psql -U reto -d reto
```

```sql
SELECT a.email, a.role, g.name AS agency, g.owner_account_id = a.id AS owns_agency
FROM onboarding.accounts a
LEFT JOIN onboarding.agencies g ON g.id = a.agency_id
WHERE a.email IN ('agente099@reto.example','agente009@reto.example','agente016@reto.example');

SELECT role, count(*) FROM onboarding.accounts GROUP BY role;
SELECT path, document FROM public.pbg_state_documents WHERE path LIKE 'leads-store/books/%' LIMIT 3;
SELECT * FROM analytics.day_rollup ORDER BY day_et DESC LIMIT 10;
```

El esquema `reto` solo aporta autenticación local: alias, sesiones y registro de
importación. `reto.agents` y `reto.agencies` son vistas de las tablas originales.
No son fuentes de datos de negocio independientes.

## API

- `GET /health`: comprueba PostgreSQL y responde 200 o 503.
- `POST /auth/get-toke`: recibe `usuario` y `contrasena`; devuelve `token`,
  `token_type: Bearer`, `expires_in` y `agent`, con el rol original.
- `GET /auth/me`: obtiene el agente mediante Bearer o la cookie HttpOnly.
- `POST /auth/logout`: revoca la sesión y elimina la cookie; devuelve 204.

```sh
curl http://localhost:8008/auth/get-toke \
  -H 'Content-Type: application/json' \
  -d '{"usuario":"agente016@reto.example","contrasena":"123456"}'
```

El token es opaco, aleatorio y solo se almacena su SHA256. Hay una sesión activa
por cuenta; otro login revoca la anterior. Vence a las ocho horas. El frontend
usa una cookie HttpOnly y SameSite, comprueba la sesión al recargar y no almacena
tokens en localStorage. Los intentos excesivos reciben 429.

## Comprobaciones

```sh
pnpm install
pnpm test
pnpm exec playwright install chromium
pnpm test:ui
uv run --with cryptography --with pyahocorasick python -m unittest discover -s tests -p 'test_replica.py'
```

Las pruebas comprueban checksums y correos sustituidos, todos los conteos de tablas,
columnas y tipos, roles y dueños de agencia, contraseñas locales, autenticación,
revocación, logout y la pantalla móvil. Las pruebas de API y base necesitan Compose.

## Regenerar desde un respaldo privado

Solo el mantenedor necesita `pg_restore`, Python 3.11+, cryptography, pyahocorasick,
el respaldo original y las claves privadas fuera del repo. Los participantes
utilizan los archivos ya preparados. El generador no modifica AWS.

```sh
uv run --with cryptography --with pyahocorasick python scripts/replica.py \
  --private-dir "$HOME/.pbg-secrets/reto-import" \
  --output data/postgres-nueva
```

El directorio privado debe contener `source.dump`, `backup-metadata.json`,
`mapping.key` y `compliance-keys.json` (lista de claves originales base64).
Revisar privacidad, referencias y manifiesto antes de reemplazar la copia incluida.
Las partes comprimidas se mantienen por debajo del límite de archivos de GitHub.
`scripts/fidelity.py` y `scripts/relationships.py` generan las huellas de los
valores de negocio y sus referencias para las pruebas de restauración.
`scripts/audit_replica.py` comprueba que los identificadores, teléfonos y secretos
originales del índice privado no aparezcan en los archivos distribuidos.

La copia completa usa un volumen nuevo `postgres_replica_v2`. El volumen anterior
`pbg-reto_postgres_data` se conserva para recuperación y no se elimina automáticamente.
No ejecutar `docker compose down -v` si se necesitan conservar cambios locales.
