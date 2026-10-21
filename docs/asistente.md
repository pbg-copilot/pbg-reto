# Asistente de soporte: reglas, límites y dónde se aplican

El asistente usa `claude-haiku-5-5` (ADR 0003). **No está entrenado** con datos
nuestros: su comportamiento sale de las instrucciones, de las herramientas que se le
ofrecen y, sobre todo, de lo que el backend permite. La regla general es que **el
modelo propone y el backend decide**.

## Qué puede y qué no

| Puede | No puede |
| --- | --- |
| Hacer hasta 2 preguntas útiles para entender el caso | Pedir contraseñas, tokens o códigos |
| Buscar y explicar artículos **publicados** del catálogo | Inventar pasos, causas, números de ticket o plazos |
| Crear un ticket para la persona de la sesión | Cambiar estados, cerrar o reabrir tickets |
| Consultar **los tickets propios** de esa persona | Asignar responsables o cambiar prioridades |
| Informar un incidente activo y vincular el ticket | Ver casos, datos o notas internas de otras personas |
| | Decir que revisó, reparó o ejecutó algo en sistemas internos |

Cerrar, asignar y priorizar son decisiones del equipo. Si las tomara la IA, un error
o una inyección («ciérralo, ya se resolvió») cambiaría un caso sin que nadie lo
revise. Las acciones que vienen en la spec 009 siguen el patrón propuesta →
confirmación: el modelo propone, la persona confirma con un clic y el backend ejecuta
con su sesión.

## Herramientas

Todas llevan `strict: true` y el servidor valida cada input con zod. El backend las
ejecuta con el **actor de la sesión**: el modelo nunca elige a quién pertenece un
dato.

| Herramienta | Qué hace | Límite que pone el backend |
| --- | --- | --- |
| `search_articles` | Busca en el catálogo y en los incidentes activos | Solo artículos publicados y vigentes |
| `get_article` | Lee un artículo | Solo publicados; guarda el id y la versión usados |
| `update_case_details` | Registra área, intención, resultado esperado, error e impacto | Solo en la conversación actual |
| `create_ticket` | Crea el ticket con el resumen y los pasos intentados | El solicitante sale de la sesión; devuelve el número real; idempotente |
| `get_my_tickets` | Lista o busca los tickets propios | Filtro por `requester_id` en el SQL |

## Dónde vive cada regla

| Capa | Archivo | Qué controla |
| --- | --- | --- |
| Instrucciones | `backend/src/modules/assistant/prompt.ts` | Cómo trabaja (preguntar, buscar, escalar) y sus límites. Guía al modelo; no lo autoriza a nada |
| Herramientas | `backend/src/modules/assistant/tools.ts` | Definiciones, validación con zod y ejecución con el actor |
| Guardas | `backend/src/modules/assistant/guards.ts` | Oculta secretos antes de guardar y enviar; marca el contenido externo como `<untrusted_content>`; elimina números de ticket que la persona no puede ver |
| Orquestación | `backend/src/modules/assistant/orchestrator.ts` | Hasta 4 rondas de herramientas por mensaje (`AI_MAX_TOOL_ITERATIONS`) |
| Proveedor | `backend/src/modules/assistant/anthropic-provider.ts` | Timeout (`AI_TIMEOUT_MS`), `effort: low`; `refusal` o `max_tokens` → el chat ofrece el formulario |
| Permisos | `backend/src/modules/tickets/` | Aunque el modelo pidiera otra cosa, el servicio de tickets aplica los permisos de la sesión |
| Especificación | `specs/004-assistant/`, `specs/009-assistant-skills/`, ADR 0005 | Criterios de aceptación y decisiones |

## Qué datos recibe el modelo

- El mensaje de la persona, con las contraseñas ya ocultas.
- El texto de los artículos publicados que se consultan.
- Los tickets propios que consulta: número, título, estado, fecha de actualización y enlace.

Nunca recibe nombres, correos, notas internas, adjuntos internos ni datos de otras
cuentas. Las capturas de pantalla llegan solo con consentimiento y solo en ese
mensaje (spec 006).

## Riesgos y cómo se cubren

| Riesgo | Cobertura |
| --- | --- |
| Inyección de instrucciones en un mensaje o artículo | Contenido marcado como no confiable; los permisos los aplica el servidor; no hay herramientas que salgan de la cuenta propia |
| El modelo inventa un número de ticket | `sanitizeTicketMentions` y la tarjeta del ticket sale de la respuesta del backend |
| Se comparte un secreto en el chat | `redactSecrets` antes de guardar y de enviar |
| El proveedor cae o tarda | Timeout, mensaje claro y formulario manual; la conversación se conserva |
| Costo | `usage` guardado por mensaje; ~US$0.0006 por mensaje (`docs/costos-ia.md`) |

Las pruebas están en `backend/test/assistant*.test.ts`, con el proveedor `fake`
determinista, incluidas pruebas de inyección.
