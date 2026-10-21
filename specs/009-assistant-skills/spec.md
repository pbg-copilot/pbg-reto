# 009 · Habilidades del asistente: diagnóstico con evidencia y acciones confirmadas

- **Estado:** Aprobada (2026-10-21) · B hecha, C pendiente
- **Prioridad:** Should
- **PDF:** §01 («No afirmar que se inspeccionó producción ni que se ejecutó una
  reparación si no existe una herramienta y evidencia que lo respalde»), §11
- **Depende de:** 002, 004
- **Decisión:** `docs/adr/0005-ai-capabilities-roadmap.md`

## Problema

Hoy el asistente solo explica y escala. El PDF permite más, siempre que haya una
herramienta real y evidencia: el asistente puede revisar datos de la propia cuenta y
ofrecer acciones simples. El **modelo nunca ejecuta**: propone, la persona confirma con
un botón y el backend ejecuta.

## Historias

- Como solicitante, quiero que el asistente revise el estado de **mi** cuenta (rol,
  agencia, estado y sesión actual) y me lo explique con esos datos.
- Como solicitante, quiero que el asistente me ofrezca **agregar un comentario a mi
  ticket** o **reabrirlo**, y que solo se haga si yo lo confirmo.

## Criterios de aceptación

**B · Diagnóstico de la propia cuenta**

| ID | Criterio |
| --- | --- |
| AC-009.1 | La herramienta `get_my_account_status` (solo lectura) devuelve, **solo de la cuenta de la sesión**: rol (etiqueta), estado de la cuenta (activa, suspendida o cancelada), si pertenece a una agencia y si es su dueño (sin nombres), el inicio y el vencimiento de la sesión actual, y las reglas de sesión de la plataforma (una sesión activa por cuenta, duración). **No** envía el historial de accesos (`onboarding.login_events`): son datos reales de producción con IP y ubicación, y la regla 3 de CLAUDE.md prohíbe copiar datos de las tablas originales al modelo. Tampoco nombres, correos, teléfonos ni facturación |
| AC-009.2 | El asistente puede decir «revisé tu cuenta» solo cuando usó la herramienta en ese turno. El mensaje guarda `meta.evidence = ["account_status"]` y la UI muestra la etiqueta «Basado en los datos de tu cuenta» |
| AC-009.3 | Casos que cubre: «la sesión se cierra sola» (vencimiento, o un inicio en otro dispositivo que cierra la sesión anterior), «no veo un módulo» (rol) y «no puedo entrar» (cuenta suspendida o cancelada: no se intenta reparar, se explica y se ofrece crear un ticket) |

**C · Acciones con confirmación (human-in-the-loop)**

| ID | Criterio |
| --- | --- |
| AC-009.4 | Las herramientas `propose_comment_on_my_ticket(number, body)` y `propose_reopen_my_ticket(number, reason)` **no ejecutan nada**: validan que el ticket sea del actor y que el estado lo permita, y crean una acción `proposed` en `helpdesk.assistant_actions`. Al modelo le devuelven «propuesta creada; espera confirmación» |
| AC-009.5 | La UI muestra una **tarjeta de acción** con el resumen exacto (ticket, texto o motivo) y los botones **Confirmar** y **Cancelar**. `POST /support/conversations/:id/actions/:actionId/confirm` ejecuta con el servicio de tickets (permisos, versión, idempotencia y evento normales). `…/cancel` la descarta |
| AC-009.6 | Una acción solo se puede confirmar una vez: un reintento devuelve el mismo resultado (`Idempotency-Key`). Vence a los 15 minutos. Si el ticket cambió de estado y la acción ya no aplica, responde 409 con un mensaje claro |
| AC-009.7 | Cada acción guarda quién la propuso (`assistant`), quién la confirmó (actor), cuándo y el resultado. El ticket registra el evento normal (`comment_added`, `reopened`) con `data.via = "assistant"` |
| AC-009.8 | Sigue sin existir ninguna herramienta que cierre tickets, cambie estados (salvo reabrir el propio, confirmado), asigne o lea casos ajenos. Una inyección que pida «confírmalo tú» no confirma nada: solo el clic del usuario llama a `/confirm` |

## Fuera de alcance

- Acciones sobre la cuenta (reenviar el correo de restablecimiento, desbloquear,
  cambiar el rol): tocan las tablas de autenticación del repo base.
- MCP y conectores externos (ADR 0005).
