# 004 · Asistente de soporte (chat con IA)

- **Estado:** Hecha (2026-10-20). T004.19 hecha el 2026-10-21 (`docs/eval-asistente.md`)
- **Prioridad:** Must
- **PDF:** §01, §02, §11
- **Depende de:** 001, 002, 003
- **Se integra con:** 006 (evidencias en el chat)

## Problema

El punto de entrada al soporte es un chat. Tiene que:
- entender el caso sin pedir datos innecesarios;
- resolver con el catálogo cuando hay solución;
- escalar a un ticket cuando no la hay o cuando el usuario lo pide.

Y todo eso sin que el modelo invente resultados, permisos ni confirmaciones, y sin
dejar al usuario sin soporte si la IA falla.

## Historias

- Como solicitante, al entrar a Soporte quiero ver el chat y un acceso visible a
  "Mis tickets".
- Quiero describir el problema con mis palabras, adjuntar evidencias y retomar una
  conversación anterior sin repetir lo que ya conté.
- Quiero una solución clara con enlace al artículo y que me pregunten si funcionó.
- Si no funciona, si no hay solución conocida o si pido hablar con una persona,
  quiero que se cree un ticket con todo el contexto y recibir el número y el enlace.
- Si la IA no responde, quiero poder crear el ticket igual sin perder lo que escribí.

## Comportamiento requerido (§02)

| Situación | Comportamiento | Garantía en el servidor |
| --- | --- | --- |
| Hay una solución aplicable | La explica con el enlace al artículo y pregunta "¿Se resolvió?" con botones Sí y No. Si el usuario dice Sí, la conversación queda resuelta **sin ticket** | El endpoint `resolution` cierra la conversación; no se crea ticket |
| La solución falla o el error persiste | Registra el paso intentado y su resultado. No vuelve a sugerir el mismo artículo. Puede ofrecer **una** alternativa; al segundo fallo escala | Si el modelo pide un artículo ya fallido, la herramienta devuelve un error; con 2 fallos, `resolution: false` crea el ticket de forma determinista |
| No hay respuesta en el catálogo | Pide solo el mínimo faltante (máximo 2 preguntas) y crea el ticket | Prompt + botón "Crear ticket" siempre visible + test de evaluación |
| Se reporta una falla o se requiere intervención | Crea el ticket distinguiendo el **síntoma reportado** de la **causa confirmada**; no exige certeza técnica | `ai_summary.confirmed_cause` siempre es `null` cuando lo crea la IA |
| El usuario pide ayuda humana | Crea el ticket directamente con el contexto disponible | Botón "Hablar con una persona" → `POST /escalate`, sin pasar por el modelo |

## Criterios de aceptación

| ID | Criterio |
| --- | --- |
| AC-004.1 | `/soporte` muestra el chat, el acceso visible "Mis tickets" y las conversaciones recientes para retomarlas |
| AC-004.2 | Cada mensaje se guarda. Al recargar o retomar, se ve el hilo completo. El mensaje del usuario queda guardado **antes** de llamar al modelo |
| AC-004.3 | El asistente registra los datos del caso (área, qué intentaba hacer, resultado esperado, error observado, impacto) con la herramienta `update_case_details`. Solo pide datos faltantes útiles; nunca contraseñas, tokens ni información técnica que el usuario no tenga |
| AC-004.4 | Si el usuario escribe algo con forma de secreto (contraseña o token), se enmascara antes de enviarlo al modelo y la UI le avisa que no lo comparta |
| AC-004.5 | Antes de proponer una solución, el asistente consulta el catálogo con `search_articles` y `get_article`. La respuesta muestra instrucciones, una tarjeta con el enlace al artículo (versión concreta) y la pregunta de confirmación con botones |
| AC-004.6 | Cada mensaje del asistente guarda `article_refs` (`article_id`, `version_id`, `version`) de los artículos que usó |
| AC-004.7 | "Sí, se resolvió" deja la conversación como `resolved` sin crear ticket (D1) |
| AC-004.8 | "No se resolvió" registra el paso intentado. El mismo artículo no se vuelve a sugerir. Al segundo fallo se crea el ticket automáticamente con los pasos intentados (D2) |
| AC-004.9 | Sin artículo aplicable, el asistente crea el ticket tras un máximo de 2 preguntas aclaratorias. Una respuesta improvisada no reemplaza la escalación |
| AC-004.10 | En un ticket creado por la IA, `ai_summary` tiene `reported_symptom`, `case_details`, `reason` (`no_article`, `solution_failed`, `failure_reported`, `human_requested`) y `confirmed_cause: null`. `original_description` contiene el texto literal de los mensajes del usuario |
| AC-004.11 | "Hablar con una persona" (botón o lenguaje natural) crea el ticket directamente con el contexto. El botón no depende del modelo |
| AC-004.12 | El chat muestra la tarjeta del ticket (número, título, estado **Abierto** y enlace `/tickets/:id`) **solo** con los datos que confirmó el backend. Si el texto del modelo menciona un `TCK-…` que no está autorizado para el usuario, se reemplaza |
| AC-004.13 | Reintentar con la misma `Idempotency-Key` devuelve el mismo resultado. Una conversación genera como máximo un ticket (restricción única). Doble click o reintento no duplican mensajes ni tickets (D2) |
| AC-004.14 | Si el proveedor falla, se agota el tiempo (`AI_TIMEOUT_MS`), el modelo rechaza la petición (`refusal`) o se corta (`max_tokens`): la API responde 503 `assistant_unavailable` y conserva el mensaje. La UI avisa del fallo, conserva el borrador, permite reintentar y ofrece "Crear ticket" con el contexto. El soporte funciona sin IA (D6) |
| AC-004.15 | Las herramientas se validan en el servidor (zod estricto, `additionalProperties: false`). La identidad sale siempre de la sesión. No existe ninguna herramienta para cambiar estados, cerrar tickets ni leer casos ajenos. Las instrucciones maliciosas en mensajes, artículos o adjuntos no amplían permisos (D5) |
| AC-004.16 | Al modelo solo se le manda: la conversación del propio usuario, el contenido publicado del catálogo, los datos públicos de los tickets del propio usuario y los metadatos de sus adjuntos. Nunca notas internas, datos de otros usuarios, nombres, correos ni secretos |
| AC-004.17 | *(Should)* Si `search_articles` encuentra un incidente activo relacionado, el asistente informa su estado público y el ticket que se cree queda vinculado al incidente |
| AC-004.18 | La UI muestra el aviso "Respuestas generadas por IA; pueden equivocarse. Nunca te pediremos contraseñas", un indicador de espera con el tiempo transcurrido y el mensaje de rate limit |
| AC-004.19 | Cada respuesta guarda el `usage` de tokens y el modelo. El ADR 0003 documenta proveedor, modelo, precios, costo estimado por conversación, límites y tratamiento de datos |
| AC-004.20 | *(Should)* `pnpm eval:assistant` corre 10 escenarios contra el modelo real: conocido, desconocido, persistente, humano, inyección, petición de contraseña, "¿revisaste producción?"… y verifica que no afirme haber inspeccionado ni reparado nada. Costo menor a $0.05 |

## Fuera de alcance

- Respuestas en streaming. La respuesta llega completa con un indicador de espera.
  Queda documentado como mejora.
- Enviar imágenes al modelo (visión). Solo se envían los metadatos del adjunto.
- Chat de voz y otros idiomas.
