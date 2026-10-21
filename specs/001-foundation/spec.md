# 001 · Foundation

- **Estado:** Hecha (2026-10-20)
- **Prioridad:** Must
- **PDF:** §10, §13
- **Depende de:** nada

## Problema

El repo base solo arranca dentro de Docker, tiene tres instalaciones de npm
separadas, un frontend en un único archivo y nada preparado para migraciones,
jobs, OpenAPI ni almacenamiento de objetos. Sin esta base, cada feature tendría que
resolver la misma infraestructura por su cuenta.

## Objetivo

Dejar un monolito modular sobre pnpm, con backend, worker y frontend listos para
sumar features, **sin romper nada de lo que ya funciona**.

## Historias

- Como desarrollador, quiero `pnpm install` y `pnpm dev` en la raíz para trabajar
  con hot-reload en API, worker y web.
- Como evaluador, quiero `docker compose up -d --build` y tener todo funcionando:
  migraciones, catálogo demo, S3 y buzón local.
- Como desarrollador, quiero `buildApp()` para probar la API con `app.inject()` sin
  levantar puertos.
- Como usuario, quiero entrar con mi cuenta y ver el nuevo estilo PBG Copilot, con
  navegación a Soporte y Tickets.

## Criterios de aceptación

| ID | Criterio |
| --- | --- |
| AC-001.1 | Desde la raíz, `pnpm install --frozen-lockfile` instala todo el workspace. No queda ningún `package-lock.json`. Solo `esbuild` puede ejecutar scripts de build (`allowBuilds`) |
| AC-001.2 | `docker compose up -d --build` levanta `postgres`, `backend`, `worker`, `frontend`, `s3` y `mailpit` en estado healthy, y crea el bucket privado |
| AC-001.3 | Al arrancar, el backend aplica las migraciones pendientes del esquema `helpdesk` bajo un advisory lock y carga los seeds de forma idempotente. Arrancar dos veces no duplica nada |
| AC-001.4 | Los tests del repo base siguen en verde sin modificarlos: `tests/api.test.mjs`, `tests/data.test.mjs`, `tests/database.test.mjs` (importa `/app/dist/db.js` y `/app/dist/passwords.js` dentro del contenedor) y `tests/ui/login.spec.js` |
| AC-001.5 | `pnpm --filter backend dev` funciona fuera de Docker contra el Postgres de compose. Lee `.env` y toma la carpeta de datos de `DATA_DIR` |
| AC-001.6 | `APP_ORIGIN` acepta una lista. Con `http://localhost:8088,http://localhost:5173` se puede hacer login desde ambos orígenes, y un origen desconocido sigue respondiendo 403 |
| AC-001.7 | `/docs` muestra la documentación OpenAPI 3 con los endpoints de auth y health. `/docs/json` devuelve el documento |
| AC-001.8 | Las variables de entorno se validan con zod al arrancar. Si falta una obligatoria, el proceso termina con un mensaje claro y sin mostrar secretos |
| AC-001.9 | El worker arranca, reclama jobs con `FOR UPDATE SKIP LOCKED`, procesa un job `noop` de prueba y reintenta con backoff si falla |
| AC-001.10 | Frontend con React Router, TanStack Query, Tailwind 4, shadcn/ui, tokens claro/oscuro de PBG Copilot y Poppins alojada localmente. El login y la pantalla de inicio conservan su comportamiento y textos (lo que verifica `login.spec.js`) con el nuevo estilo. La consola no muestra violaciones de CSP |
| AC-001.11 | La barra superior autenticada tiene wordmark, navegación (Soporte, Tickets y, para admin, Catálogo y Métricas), una campana de notificaciones como placeholder y el menú de cuenta con **solo** "Logout" |
| AC-001.12 | `.env.example` documenta todas las variables nuevas con valores falsos. No se commitea ningún secreto |
| AC-001.13 | Existen los ADR 0001–0004 en `docs/adr/` |
| AC-001.14 | `pnpm typecheck`, `pnpm lint` y `pnpm test` pasan en la raíz |

## Fuera de alcance

Cualquier funcionalidad de tickets, chat, catálogo, notificaciones o adjuntos. Esta
spec solo deja preparadas las piezas.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Romper `database.test.mjs` al reestructurar el backend | Mantener `dist/db.js` (exporta `pool`) y `dist/passwords.js` (exporta `checkPassword`) en `/app` dentro de la imagen, sin efectos secundarios al importarlos |
| La imagen de MinIO no está disponible en Docker Hub (404 el 2026-10-20) | Servicio `s3` con imagen fija; MinIO de `quay.io` si se puede descargar, si no `rustfs/rustfs:1.0.3`. El código solo usa la API S3 |
| La CSP de nginx bloquea fuentes externas o estilos inyectados | Poppins con `@fontsource`; revisar que ningún componente inyecte `<style>` en runtime |
| `pnpm deploy` omite `dist/` porque está en `.gitignore` | Copiar `dist/` de forma explícita desde el stage de build |
