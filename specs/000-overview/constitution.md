# Constitución del proyecto

Principios que aplican a todas las specs. Cuando una decisión los contradice, se
documenta en un ADR (`docs/adr/`) antes de implementarla.

1. **El PDF manda.** Los seis casos de demostración (D1–D6) van antes que cualquier
   extra. Lo que el PDF no pide se agrega solo si es barato y reduce riesgo.
2. **Seguridad por defecto.**
   - Todo endpoint requiere sesión, salvo `/health`, `/auth/get-toke` y `/docs`.
   - La autorización se aplica en el servidor y dentro de la consulta SQL: el
     filtro por actor va en el `WHERE`, nunca después.
   - Un recurso ajeno responde 404.
3. **PostgreSQL es la fuente de verdad.**
   - Cada acción con efectos es una transacción.
   - Los efectos secundarios (notificaciones, correos) salen por outbox, nunca
     "después del commit".
4. **Idempotencia y concurrencia en toda acción con efectos.**
   - `Idempotency-Key` en las creaciones.
   - `version` para la concurrencia optimista.
   - Repetir la misma acción no crea un evento nuevo.
5. **La IA asiste, no autoriza.**
   - El modelo no decide identidad, permisos, estados, IDs ni enlaces.
   - Todo lo que el modelo pide pasa por herramientas validadas en el servidor.
   - Sin IA, el soporte sigue funcionando.
6. **Datos mínimos y ficticios.**
   - La demo usa contenido ficticio marcado como ejemplo.
   - Al modelo se le manda el mínimo necesario.
   - Nada de PII en logs.
   - Los datos y esquemas originales del repo base no se tocan.
7. **Reproducible.** `docker compose up -d --build` deja todo listo: migraciones,
   catálogo demo y servicios. No necesita pasos manuales.
8. **Los tests son el contrato.**
   - Cada criterio de aceptación tiene al menos un test con su ID.
   - Los tests del repo base (`tests/*.test.mjs` y `tests/ui/login.spec.js`)
     siguen en verde.
9. **Simplicidad.**
   - Monolito modular con un solo backend, un worker del mismo código y una sola
     base de datos.
   - No se agrega infraestructura que el PDF no pida.
10. **Idioma.** La UI y los mensajes de error para el usuario van en español. El
    código, los identificadores, los commits y los logs van en inglés.
