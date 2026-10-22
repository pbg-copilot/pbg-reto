# Costo del asistente de IA según el número de clientes

Estimación del gasto en la API de Anthropic cuando el soporte con IA está en uso.
Precios oficiales consultados el 2026-10-20 en
`platform.claude.com/docs/en/about-claude/pricing`.

> **Resumen:** con `claude-haiku-5-5`, una conversación de soporte cuesta alrededor
> de **US$0.009** (≈ US$0.006 con caché). Con 1.000 clientes que abren 3
> conversaciones al mes, son unos **US$26 al mes**.

## 1. Precios del modelo

`claude-haiku-5-5`, en dólares por millón de tokens. Aplica a prompts de hasta 100.000
tokens; nuestras llamadas están muy por debajo.

| Concepto | Precio |
| --- | --- |
| Entrada | $0.10 |
| Salida (incluye el razonamiento interno del modelo) | $0.50 |
| Escritura de caché (5 min) | $0.125 |
| Lectura de caché | $0.01 |

Si un prompt superara los 100K tokens, el precio subiría a $0.50 / $2.50. El sistema
limita el largo de las conversaciones para que eso no pase.

## 2. Supuestos

| Supuesto | Valor | Por qué |
| --- | --- | --- |
| Tokens fijos por llamada (instrucciones + herramientas) | ~2.500 | Son iguales en todas las llamadas y se pueden cachear (mínimo cacheable de Haiku 5.5: 512) |
| Tokens variables por llamada (historial, artículos, resultados) | ~1.500 en promedio | Crece con la conversación |
| Tokens de salida por llamada | ~600 | Respuesta, llamadas a herramientas y razonamiento con esfuerzo `low` |
| Llamadas al modelo por mensaje del usuario | 2,5 | Buscar artículo → leerlo → responder |
| Mensajes del usuario por conversación | 5 | Describir, aclarar, confirmar |
| **Llamadas por conversación** | **12,5** | |

Lo que **no consume IA**:
- los botones "¿Se resolvió?" y "Hablar con una persona";
- la creación manual de tickets;
- comentarios, notificaciones, adjuntos y todo el panel de administración.

Solo cuesta cada mensaje que la persona le escribe al asistente.

## 3. Costo por conversación

| | Tokens | Sin caché | Con caché |
| --- | --- | --- | --- |
| Entrada | 50.000 | $0.0050 | $0.0025 |
| Salida | 7.500 | $0.0038 | $0.0038 |
| **Total por conversación** | **57.500** | **≈ $0.0088** | **≈ $0.0062** |

La salida es más de la mitad del costo. Por eso el esfuerzo del modelo se mantiene
en `low` para el chat.

## 4. Costo mensual según el número de clientes

"Cliente" es un usuario de la plataforma (agente o dueño de agencia) que usa
soporte. Los escenarios:
- **Bajo:** 1 conversación al mes por cliente.
- **Medio:** 3 conversaciones al mes.
- **Alto:** 8 conversaciones al mes.

Las cifras son sin caché, es decir, conservadoras. Con caché se restan ~30 %.

| Clientes | Bajo | Medio | Alto |
| ---: | ---: | ---: | ---: |
| 100 | $0.88 | $2.63 | $7.00 |
| 500 | $4.38 | $13.13 | $35.00 |
| 1.000 | $8.75 | $26.25 | $70.00 |
| 5.000 | $43.75 | $131.25 | $350.00 |
| 10.000 | $87.50 | $262.50 | $700.00 |
| 50.000 | $437.50 | $1.312.50 | $3.500.00 |

**Por cliente:**

| Escenario | Costo mensual por cliente |
| --- | --- |
| Bajo | ≈ $0.009 |
| Medio | ≈ $0.026 |
| Alto | ≈ $0.07 |

**Volumen de tokens (escenario medio):** 1.000 clientes generan 3.000
conversaciones, unos **172 millones de tokens al mes**: 150 M de entrada y 22,5 M de
salida.

## 5. Si se usara un modelo más potente

Mismo volumen y sin caché. Son cifras aproximadas: cada modelo genera cantidades
distintas de razonamiento.

| Modelo | Precio (entrada / salida) | Por conversación | 1.000 clientes, escenario medio |
| --- | --- | ---: | ---: |
| **Claude Haiku 5.5** (elegido) | $0.10 / $0.50 | $0.009 | **$26** |
| Claude Sonnet 5.5 | $2 / $10 | $0.175 | $525 |
| Claude Opus 5.5 | $4 / $20 | $0.35 | $1.050 |

Haiku 5.5 alcanza para esta tarea: clasificar el caso, buscar en un catálogo, seguir
reglas y llamar herramientas. Las decisiones críticas (permisos, estados, cierre)
nunca las toma el modelo.

## 6. Qué haría subir o bajar el costo

| Factor | Efecto | Control en el sistema |
| --- | --- | --- |
| Conversaciones largas | El historial crece y cada llamada cuesta más | Límite de mensajes por conversación; al superarlo se sugiere crear el ticket |
| Más razonamiento (esfuerzo `medium`/`high`) | Más tokens de salida | Esfuerzo fijo en `low` para el chat |
| Enviar imágenes al modelo | Muchos tokens de entrada por imagen | No se envían; el modelo solo recibe nombre y tipo del adjunto |
| Abuso o uso automatizado | Picos de gasto | Rate limit de 20 mensajes por minuto por usuario + límite mensual de gasto en la Console de Anthropic |
| Prompt caching | −30 % aprox. | Instrucciones y herramientas fijas al inicio de cada llamada |
| Respuestas deterministas | Ahorran llamadas | Confirmación de resolución y escalación por botón, sin IA |

## 7. Créditos actuales del reto

Con **US$5** alcanza para unas **570 conversaciones** sin caché, o unas 800 con
caché. El desarrollo, las pruebas manuales y la demo usan muy por debajo de eso. Las
pruebas automáticas usan un proveedor simulado y no gastan nada.

Los límites de uso de la API (solicitudes y tokens por minuto) dependen del nivel de
la cuenta, que sube con el gasto acumulado. Para producción a gran escala conviene
revisar el nivel en la Console → Limits.

## 8. Medición real

Con el asistente ya implementado, 4 mensajes reales con `claude-haiku-5-5` (detalle en
`docs/adr/0003-ai-provider-haiku.md`) costaron **US$0.0022**, unos **US$0.00055 por
mensaje**. La estimación de las secciones 3 y 4 es conservadora: el costo real es más o
menos un tercio, porque el prompt caching funciona desde la segunda llamada y el esfuerzo
`low` produce respuestas breves.

**Funciones agregadas después (specs 006, 007 y 009):**

| Función | Costo aproximado | Cuándo se paga |
| --- | --- | --- |
| Captura compartida con el asistente (visión) | ~1.500 tokens de entrada ≈ US$0.00015 por turno | Solo si la persona marca el consentimiento; se reenvía en los turnos siguientes de esa conversación |
| Diagnóstico de cuenta y propuestas de acción | Unos cientos de tokens por uso | Cuando el asistente usa la herramienta |
| Copiloto: «Diagnosticar caso» o «Sugerir respuesta» | ≈ US$0.0002 por uso (medido) | Solo cuando un admin pulsa el botón |
| Posibles duplicados | US$0 | Es una búsqueda en la base, sin IA |

## 9. Cómo se mide en la práctica

- Cada respuesta del asistente guarda los tokens reales que informa la API
  (`usage`): entrada, salida y caché.
- Cada uso del copiloto queda en `helpdesk.ai_usage`.
- La vista de administración (`/admin/metricas`) muestra:
  - el costo real del rango, separado entre chat y copiloto;
  - el promedio por conversación.
- La Console de Anthropic (Usage) muestra el gasto facturado.

## 10. Qué no incluye

Solo cubre el costo del modelo de IA. No incluye servidores, base de datos,
almacenamiento de archivos ni el proveedor de correo en producción.
