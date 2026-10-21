# ADR 0003 · Proveedor de IA: Anthropic `claude-haiku-5-5`

- **Estado:** Aceptada (2026-10-20). Costos medidos en la spec 004 (chat) y completados
  en la 008 con visión, diagnóstico y copiloto.
- **Contexto del PDF:** §11, "El participante elige un proveedor y modelo, documenta
  costo y limitaciones, y configura las claves en el backend mediante variables de
  entorno."

## Decisión

- **Proveedor:** Anthropic, con el SDK oficial `@anthropic-ai/sdk`.
- **Modelo:** `claude-haiku-5-5`, configurable con `AI_MODEL`.
- **Configuración:** solo en el backend, con `ANTHROPIC_API_KEY` y `AI_PROVIDER`. El
  frontend nunca ve la key.
- **Proveedor `fake` determinista.** Se usa en tests y en la demo cuando no hay key;
  la app arranca igual sin ella.

## Por qué Haiku 5.5

- La tarea encaja con el modelo: clasificar el caso, buscar en un catálogo, seguir
  reglas y llamar herramientas. Haiku 5.5 sigue instrucciones y usa herramientas
  bien.
- Es el más barato: $0.10 / $0.50 por millón de tokens, unos US$0.009 por
  conversación. Ver `docs/costos-ia.md`.
- Las decisiones críticas (identidad, permisos, estados, cierre) **no** las toma el
  modelo, así que no hace falta un modelo más caro.

## Límites conocidos

- **Puede equivocarse.** Por eso las respuestas salen del catálogo, se pide
  confirmación y escalar siempre está a un botón de distancia.
- **Haiku no tiene fallback del servidor ante `refusal`.** Si el modelo rechaza o
  falla, el chat ofrece crear el ticket con el formulario.
- **Precio por largo del prompt.** Por encima de 100K tokens sube 5×. El largo de las
  conversaciones se limita.
- **Detalles de la API.**
  - No acepta `temperature` ni prefill.
  - El razonamiento cuenta como salida; se usa `effort: low` para el chat.

## Tratamiento de datos

Al modelo **solo** se le envía:
- la conversación del propio usuario;
- el contenido publicado del catálogo, que es ficticio;
- los datos públicos de sus propios tickets;
- los metadatos de sus adjuntos (nombre, tipo, tamaño).

Nunca:
- notas internas;
- datos de otros usuarios;
- nombres ni correos;
- secretos (los mensajes con forma de contraseña o token se enmascaran).

La demo usa contenido ficticio, como pide el PDF.

## Nota operativa

La API exige una key **asociada a un workspace**. Las keys de usuario
(`sk-ant-usr-…`) piden el header `anthropic-workspace-id`. Conviene crear la key
dentro de un workspace en la Console.

## Medición real (2026-10-20, `claude-haiku-5-5`, `effort: low`)

| Caso | Llamadas | Tokens (entrada / salida / lectura de caché) | Costo | Latencia |
| --- | --- | --- | --- | --- |
| D1 problema conocido (búsqueda → artículo → respuesta) | 3 | 1.907 / 456 / 5.092 | US$0.00079 | 18,5 s (primera petición: compila los esquemas estrictos) |
| D2, 1.er mensaje (registra el caso y pregunta) | 2 | 814 / 538 / 5.092 | US$0.00040 | 4,5 s |
| D2, 2.º mensaje (crea el ticket) | 2 | 3.190 / 1.093 / 5.092 | US$0.00092 | 5,7 s |
| D5 inyección (se niega sin usar herramientas) | 1 | 135 / 115 / 2.546 | US$0.00010 | 1,4 s |

- **Promedio:** ≈ US$0.00055 por mensaje del usuario, menos que lo estimado en
  `docs/costos-ia.md` (≈ US$0.002). El prefijo de tools + system se sirve desde la
  caché a partir de la segunda llamada.
- **Comportamiento observado:**
  - usa el artículo correcto, aclara que es de ejemplo y pregunta si se resolvió;
  - sin artículo, hace como máximo 2 preguntas útiles y escala;
  - ante la inyección, se niega y no muestra datos ajenos.

## Medición de las funciones agregadas (specs 006, 007 y 009)

| Función | Medición | Costo | Cuándo se paga |
| --- | --- | --- | --- |
| Copiloto · «Sugerir respuesta» | 703 de entrada / 338 de salida | ≈ US$0.00024 por uso | Solo cuando un admin pulsa el botón |
| Copiloto · «Resumir caso» | 376 de entrada / 307 de salida | ≈ US$0.00019 por uso | Ídem |
| Visión (captura compartida con consentimiento) | ≈ 1.500 tokens de entrada por imagen | ≈ US$0.00015 por turno | Solo si la persona marca la casilla. La imagen se reenvía en los turnos siguientes de esa conversación |
| Diagnóstico de cuenta y propuestas de acción | Unos cientos de tokens por llamada a la herramienta | < US$0.0001 | Cuando el asistente usa la herramienta |
| Posibles duplicados | Búsqueda en PostgreSQL, sin modelo | US$0 | — |

- El copiloto es una sola llamada sin herramientas, así que no usa la caché del prefijo
  del chat. Aun así cuesta menos de un cuarto de centavo de dólar por cada 10 usos.
- Cada uso queda en `helpdesk.ai_usage` y el panel `/admin/metricas` muestra el costo
  real del rango, separado entre chat y copiloto.

## Límites encontrados durante la implementación

- **Thinking ligado a la conversación.** Haiku 5.5 valida que los bloques `thinking`
  reenviados correspondan exactamente al historial que los produjo. Si el historial
  cambia (un mensaje editado, un prompt o una herramienta nuevos entre versiones),
  responde 400. El proveedor reintenta **una vez** sin los bloques `thinking`; el texto
  y las llamadas a herramientas se conservan (`assistant-provider.test.ts`).
- **Primera llamada lenta.** La primera petición tras un despliegue tarda más (≈ 18 s en
  D1) porque la API compila los esquemas estrictos de las herramientas. Las siguientes
  responden en 1–6 s. El timeout es `AI_TIMEOUT_MS` (20 s); si se agota, el chat ofrece
  el formulario.
- **Límites de la cuenta.** Las solicitudes y tokens por minuto dependen del nivel de la
  cuenta de Anthropic. Para producción hay que revisar el nivel y poner alertas de
  presupuesto (ver `docs/despliegue-y-escalabilidad.md`).
