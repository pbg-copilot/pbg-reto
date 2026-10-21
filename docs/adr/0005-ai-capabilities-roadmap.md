# ADR 0005 · Más capacidades para la IA: herramientas propias, MCP y skills

- **Estado:** Aceptada (2026-10-21)
- **Contexto del PDF:**
  - §01: «No afirmar que se inspeccionó producción ni que se ejecutó una reparación
    si no existe una herramienta y evidencia que lo respalde».
  - §11: herramientas acotadas y permisos del lado del servidor.

## Contexto

El asistente de la spec 004 tiene 5 herramientas:
- `search_articles`: buscar en el catálogo;
- `get_article`: leer un artículo;
- `update_case_details`: guardar los datos del caso;
- `create_ticket`: crear el ticket;
- `get_my_tickets`: listar los tickets propios.

Para darle más capacidades se evaluaron cuatro caminos:
- herramientas propias en el backend;
- MCP (Model Context Protocol);
- Agent Skills;
- embeddings.

La regla que no cambia: **la identidad, los permisos, los estados y el cierre los
decide el backend, no el modelo**.

## Decisión

| # | Capacidad | Decisión | Dónde |
| --- | --- | --- | --- |
| A | Leer capturas (visión) | **Sí**, con consentimiento por imagen, solo PNG/JPEG/WEBP/GIF del chat propio y solo en el turno en que se comparte | 006 (AC-006.11 a 13) |
| B | Diagnóstico de la propia cuenta | **Sí**, herramienta de solo lectura `get_my_account_status` con proyección mínima (sin IP ni ubicación) | 009 |
| C | Acciones sobre los tickets propios | **Sí**, pero solo como **propuesta**: el modelo propone, la persona confirma con un clic y el backend ejecuta con su sesión | 009 |
| D | Copiloto del equipo | **Sí**: resumir el caso, sugerir una respuesta (borrador, nunca se envía solo) y detectar duplicados con pg_trgm | 007 |
| E | MCP | **No por ahora**, documentado como siguiente paso | Este ADR |
| F | Agent Skills | **No** | Este ADR |
| G | Embeddings | **Opcional**; no hacen falta con el catálogo actual | Este ADR |

## Por qué herramientas propias y no MCP (E)

- **Tamaño.** Las herramientas viven en el mismo proceso que los permisos y las
  transacciones. Con MCP, cada llamada cruzaría un proceso más y habría que propagar
  la identidad del usuario a ese servidor: más superficie y más latencia sin ganar
  capacidad.
- **Las fuentes son internas.** Todo está en nuestra base de datos. MCP aporta cuando
  hay sistemas de terceros (CRM, monitoreo, status page) o cuando varios clientes de
  IA reutilizan las mismas herramientas.
- **Cuándo sí:**
  1. Si el soporte necesita datos de sistemas externos, por ejemplo el estado real de
     un servicio en el monitoreo. Ahí el backend actúa como **cliente MCP**: el
     servidor MCP no recibe la sesión del usuario, solo parámetros ya autorizados.
  2. Si el equipo quiere consultar tickets desde su propio cliente (Claude Desktop o
     Claude Code). Ahí se expone un **servidor MCP de solo lectura para admins**, con
     su propio token y auditoría.

## Por qué no Agent Skills (F)

Las Agent Skills empaquetan instrucciones y scripts para un agente con entorno de
ejecución (archivos, bash). Nuestro asistente no ejecuta código ni tiene sistema de
archivos, y el conocimiento ya está en el catálogo. Pasarlo a skills duplicaría la
fuente de verdad y agregaría un riesgo (ejecución de código) que el reto no necesita.

## Embeddings (G)

La búsqueda full-text en español con `unaccent` y `pg_trgm` resuelve el catálogo
actual (13 artículos) y los duplicados. Se pasa a `pgvector` con embeddings
**si** el catálogo crece a cientos de artículos o aparecen fallos de recuperación
por sinónimos en la evaluación del asistente. La interfaz `search.ts` ya aísla este
cambio.

## Consecuencias

- **8 herramientas en vez de 5.** El costo por mensaje sube poco, porque las
  definiciones van en el bloque cacheado del system prompt.
- **Un patrón nuevo: propuesta y confirmación.** Lo usan las acciones de C. Toda
  herramienta futura que escriba datos debe usarlo.
- **Costos medidos.**
  - La visión cuesta unos US$0.00015 por captura.
  - El copiloto se mide aparte, en `helpdesk.ai_usage`.
- **Riesgos y mitigaciones:**
  - inyección desde el ticket o la captura → contenido marcado como no confiable;
  - filtración de notas internas en el borrador público → se arma el contexto con el
    serializador del solicitante;
  - confirmación forzada por el modelo → solo un `POST` del usuario confirma.
