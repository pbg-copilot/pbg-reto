# ADR 0003 · Proveedor de IA: Anthropic `claude-haiku-5-5`

- **Estado:** Aceptada (2026-10-20). Los costos medidos se completan en la spec 004.
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
