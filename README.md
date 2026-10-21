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
La inspección estructural, relaciones confirmadas y límites de uso para el chat
están documentados en [`docs/data-model.md`](docs/data-model.md).

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
- `POST/GET /api/conversations`, `GET /api/conversations/:conversationId` y
  `POST /api/conversations/:conversationId/messages`: crean, listan, recuperan
  y guardan conversaciones y mensajes. `GET /api/clients` busca libros con
  ownership verificable y `POST /api/conversations/:conversationId/client`
  asocia o cambia el cliente activo con auditoría. La ruta
  `/api/conversations/:conversationId/quotes` devuelve registros analíticos que
  coinciden exactamente por ID de cliente y cuenta propietaria, con referencias
  y faltantes; la API las define como instantáneas analíticas, no como ofertas
  vigentes o aprobadas. Las reglas siguen sin estar disponibles.
  Contrato y respuestas:
  [`docs/api-conversations.md`](docs/api-conversations.md).

Al iniciar, la API aplica en una transacción las migraciones versionadas de
`backend/migration_*.sql` después de preparar el esquema local `reto`. Registra
versión y checksum en `reto.schema_migrations`; los archivos aplicados no se
pueden modificar silenciosamente. La primera migración añade `reto.chat_conversations`,
`reto.chat_messages` y `reto.chat_actions`, sin alterar las tablas originales de
negocio. Las tablas de chat se describen en la migración y en `docs/spec.md`.

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
npm ci
npm test
npx playwright install chromium
npm run test:ui
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
