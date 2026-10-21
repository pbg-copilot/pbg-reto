# 008 · Tareas

## E2E

- [x] **T008.1** Configuración E2E de Playwright, setup de `storageState` y helpers
  de API, Mailpit y compose.
- [x] **T008.2** `d1-known-issue.spec.ts`. → AC-008.2
- [x] **T008.3** `d2-escalation.spec.ts`: sin artículo + reintento sin duplicado +
  variante de dos fallos. → AC-008.2
- [x] **T008.4** `d3-admin-flow.spec.ts`: solicitante desconectado, admin con todo el
  ciclo, notificaciones y correos en Mailpit. → AC-008.2
- [x] **T008.5** `d4-reopen.spec.ts`: reabrir, historial, aislamiento de notas
  internas y sus adjuntos. → AC-008.2
- [x] **T008.6** `d5-isolation.spec.ts`: URLs ajenas → 404 en UI y API, más inyección
  en el chat. → AC-008.2
- [x] **T008.7** `d6-resilience.spec.ts`: IA caída con formulario, Mailpit detenido
  y recuperado, conflicto de dos admins. → AC-008.2

## Documentación

- [x] **T008.8** README completo con el guion de demo. → AC-008.4
- [x] **T008.9** `docs/api.md` y `docs/permisos.md` con referencias a tests. → AC-008.5
- [x] **T008.10** Completar el ADR 0003 con el costo real medido.

## Verificación final

- [x] **T008.11** Clon limpio, arranque y todos los tests en verde. → AC-008.1, AC-008.3
- [x] **T008.12** Revisión de secretos y datos personales:
  `git grep -nE 'sk-ant-|AKIA|ghp_|BEGIN (RSA|OPENSSH)'`, y revisar que los seeds
  solo tengan datos ficticios. → AC-008.6
- [x] **T008.13** Actualizar el estado de todas las specs. → AC-008.8
- [x] **T008.14** Redactar la descripción del PR, **sin crearlo** hasta que el
  usuario lo pida. → AC-008.7
- [x] **T008.15** `pnpm test:ui` corre con el asistente simulado, igual que el E2E,
  para que ningún test use la API real. → AC-008.3

## Notas de implementación

- **E2E con el asistente simulado.**
  - `pnpm test:e2e` (`tests/e2e/run.mjs`) recrea el backend y el worker con
    `compose.e2e.yaml` (`AI_PROVIDER=fake`).
  - Al terminar los restaura con la configuración del `.env`, también ante un fallo o
    una señal (SIGINT, SIGTERM, SIGHUP).
  - `pnpm test:ui` usa el mismo runner con `--ui` (T008.15). Antes corría contra el
    modelo que tuviera el stack: con Haiku activo, gastaba unos US$0.003 por corrida.
- **Frases de D2.** La búsqueda une palabras con OR, así que casi cualquier frase
  encuentra un artículo. Las frases de D2 se eligieron verificando con
  `GET /support/articles?q=…` que no tuvieran coincidencias.
- **Cuentas.** El setup inicia sesión una vez por cuenta y guarda el `storageState`.
  Esto respeta el límite de 15 logins por minuto. Se usan solo cuentas de test
  (`agente048`, `agente049`, `agente015`, `agente104`).
- **Limpieza.** Cada spec borra en `afterAll` los tickets y conversaciones que crearon
  las cuentas de test desde que empezó la corrida. D6b vuelve a levantar Mailpit en un
  `finally` y en el `afterAll`.
- **Copia limpia (T008.11).** Se verificó sin levantar un segundo stack, porque eso
  restauraría otra réplica completa de la base:
  - se copió el árbol de trabajo sin archivos ignorados ni `.env`, con
    `cp .env.example .env`;
  - `pnpm install --frozen-lockfile`, `build`, `typecheck`, `lint` y
    `docker compose -p reto-clean build` dieron verde;
  - los tests corrieron en el stack de desarrollo: `test:unit` 140/140, `test:ui` 22/22,
    `test:e2e` 10/10 (tres corridas completas) y `pnpm test` del repo base 6/6.

  El `up` desde cero con otros puertos queda como verificación opcional.
- **Datos personales (T008.12).**
  - Se cruzaron los nombres de `reto.agents` con los archivos de la rama, sin
    imprimirlos.
  - Un test de la 003 (`articles.test.ts`) tenía escrito el nombre real de la cuenta de
    test `agente048`. Ahora lo lee de la base, como ya hacían sus aserciones.
  - El nombre sigue en el historial (commit `9f2ef5d`). Reescribirlo es decisión del
    usuario.
  - Las únicas otras coincidencias están en la sección del README que escribió el
    mantenedor y que ya estaba en `main`.
- **Lint.** Se corrigieron dos asignaciones sin uso en `run.mjs` y `d4-reopen.spec.ts`.
