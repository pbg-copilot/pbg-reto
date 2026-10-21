# 008 · Plan

## E2E (`tests/e2e/`, Playwright)

- `playwright.e2e.config.ts`:
  - `baseURL` http://localhost:8088;
  - dos `storageState` (solicitante y admin) generados por un setup project que hace
    login por UI con cuentas de **test**: `agente048` y `agente015`;
  - `workers: 1`, porque comparten la base.
- El compose de E2E es el normal con `AI_PROVIDER=fake`. Los tests no dependen del
  modelo real.
- Helpers:
  - `newContext(role)`;
  - `api(role)` para preparar datos rápido vía API;
  - `mailpit.messages(to)` contra `http://localhost:8025/api/v1/messages`;
  - `compose(cmd)` para detener y arrancar `mailpit` (solo D6b; el test se salta si
    no hay acceso a Docker).
- Cada spec E2E se llama con el ID del caso (`d1-known-issue.spec.ts`…) e incluye en
  el título los `AC-…` que cubre.

## Documentación

| Archivo | Contenido |
| --- | --- |
| `README.md` | Reescritura de las secciones "Iniciar" y "API" y nuevas: Soporte con IA, Desarrollo con pnpm, Guion de demo, Costos y límites del modelo, Archivos, Notificaciones, Métricas, Troubleshooting. Se conserva intacta la documentación original de datos y réplica (es del mantenedor) |
| `docs/api.md` | Copia legible de `000-overview/api-conventions.md` más un ejemplo `curl` por recurso |
| `docs/permisos.md` | Matriz con una columna "Test" que referencia el archivo y el AC |
| `docs/adr/` | 0001–0004 (desde 001) y los que surjan (por ejemplo, 0005 polling vs SSE) |

## Verificación final

1. Clonar en una carpeta temporal la rama local (`git clone --branch tickets-ia-alex-castro <ruta-local>`).
2. Usar puertos alternativos en `.env` para no chocar con el stack de desarrollo, o
   detener el actual.
3. `docker compose up -d --build` y medir el tiempo.
4. Correr todos los tests.
5. Recorrer el guion de demo a mano con `AI_PROVIDER=anthropic` (Haiku) y anotar el
   costo real de la sesión (Console → Usage) en el ADR 0003.

## PR

- **Título:** `feat: soporte y tickets con IA (reto PBG)`.
- **Cuerpo:** resumen, cómo probar, checklist D1–D6, decisiones (enlaces a ADR),
  límites y trabajo futuro, y la nota de que los datos de demo son ficticios.
- **Se crea solo cuando el usuario lo indique.** No hay merge.
