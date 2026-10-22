import type { FastifyInstance } from "fastify";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../../shared/auth/authorization.js";
import { isAuthorizedAppointmentAgent } from "../services/appointment-authorization.js";
import { formatAppointmentLocalStart } from "../presentation/appointment-presenter.js";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";

export function registerAppointmentChatRoutes(
  app: FastifyInstance,
  { pool, digest, tokenOf }: RouteDependencies,
): void {
  app.post<{
    Params: { conversationId: string };
    Body: {
      content: string;
      kind: "request_details" | "invalid_details" | "review" | "repeat_confirmation" | "created" | "conflict" | "cancelled" | "appointments_list";
      expectedClientPath: string;
      expectedClientRecordId: string;
      confirmationId?: string;
      appointmentId?: string;
    };
  }>(
    "/api/conversations/:conversationId/appointment-chat",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId"],
          properties: { conversationId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["content", "kind", "expectedClientPath", "expectedClientRecordId"],
          properties: {
            content: { type: "string", minLength: 1, maxLength: 4000 },
            kind: { type: "string", enum: ["request_details", "invalid_details", "review", "repeat_confirmation", "created", "conflict", "cancelled", "appointments_list"] },
            expectedClientPath: { type: "string", minLength: 1, maxLength: 1000 },
            expectedClientRecordId: { type: "string", minLength: 1, maxLength: 200 },
            confirmationId: { type: "string", format: "uuid" },
            appointmentId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (req, reply) => {
      const content = req.body.content.trim();
      if (!content)
        return reply.code(400).send({ error: "invalid_request", message: "El mensaje no puede estar vacío." });
      const needsConfirmation = req.body.kind === "review" || req.body.kind === "repeat_confirmation";
      if (needsConfirmation !== (req.body.confirmationId !== undefined) ||
          (req.body.kind === "created") !== (req.body.appointmentId !== undefined))
        return reply.code(400).send({ error: "invalid_request", message: "Faltan datos para responder en el chat de citas." });

      const result = await withAuthorizedConversationTransaction(
        pool, digest(tokenOf(req)), req.params.conversationId,
        async (client, conversation, principal) => {
          if (conversation.status !== "active") return { state: "archived" as const };
          if (principal.role !== "agent" && req.body.kind !== "appointments_list") return { state: "agent_only" as const };
          if (!conversation.active_client_path || !conversation.active_client_record_id)
            return { state: "client_not_selected" as const };
          if (conversation.active_client_path !== req.body.expectedClientPath ||
              conversation.active_client_record_id !== req.body.expectedClientRecordId)
            return { state: "context_changed" as const };
          const profile = await getAuthorizedClientProfile(client, principal, conversation.active_client_path, conversation.active_client_record_id);
          if (!profile) return { state: "client_not_found" as const };
          const { rows: agentRows } = await client.query(
            `SELECT NULLIF(trim(concat_ws(' ', first_name, middle_name, last_name)), '') AS name
               FROM onboarding.profiles WHERE account_id = $1`,
            [principal.accountId],
          );
          const agentName = agentRows[0]?.name || "Agente conectado";
          let response = "No pude completar la solicitud de cita.";

          if (req.body.kind === "request_details") {
            response = "Claro. Indícame la fecha y hora local como AAAA-MM-DD HH:mm o DD/MM/AAAA HH:mm; por ejemplo, 2026-10-25 15:00 o 25/10/2026 15:00. Usaré America/Bogota y una duración de 30 minutos por defecto; puedes indicar otra duración en minutos. Antes de guardar te mostraré los datos para que los confirmes.";
          } else if (req.body.kind === "invalid_details") {
            response = "No pude validar esos datos. Envíame una fecha válida como AAAA-MM-DD HH:mm o DD/MM/AAAA HH:mm. Puedes añadir la duración en minutos. Todavía no se guardó ninguna cita.";
          } else if (req.body.kind === "cancelled") {
            response = "De acuerdo, cancelé la solicitud. No se guardó ninguna cita.";
          } else if (req.body.kind === "conflict") {
            const { rows } = await client.query(
              `SELECT 1 FROM reto.chat_actions
                WHERE conversation_id = $1 AND actor_account_id = $2
                  AND action_type = 'appointment.created'
                  AND outcome = 'conflict' AND error_code = 'slot_taken'
                  AND occurred_at >= now() - interval '5 minutes'
                LIMIT 1`,
              [conversation.id, principal.accountId],
            );
            if (!rows.length) return { state: "conflict_not_found" as const };
            response = "Ese horario se cruzó con otra cita y no se guardó. Envíame otra fecha y hora para preparar una nueva confirmación.";
          } else if (needsConfirmation) {
            const { rows } = await client.query(
              `SELECT action, agent_account_id,
                      to_char(local_start, 'DD/MM/YYYY') AS local_date,
                      to_char(local_start, 'HH24:MI') AS local_time,
                      time_zone,
                      start_utc_offset_minutes,
                      extract(epoch FROM (end_at - start_at))::int / 60 AS duration_minutes
                 FROM reto.chat_appointment_confirmations
                WHERE id = $1 AND conversation_id = $2
                  AND requested_by_account_id = $3
                  AND client_document_path = $4 AND client_record_id = $5
                  AND status = 'pending' AND expires_at > now()`,
              [req.body.confirmationId, conversation.id, principal.accountId, conversation.active_client_path, conversation.active_client_record_id],
            );
            const confirmation = rows[0];
            if (!confirmation || confirmation.action !== "create" ||
                !(await isAuthorizedAppointmentAgent(client, principal, confirmation.agent_account_id)))
              return { state: "confirmation_not_found" as const };
            response = `Confirma la creación de esta cita:\nCliente: ${profile.name || "Cliente activo"}\nAgente: ${agentName}\nFecha y hora: ${formatAppointmentLocalStart(confirmation.local_date, confirmation.local_time, Number(confirmation.start_utc_offset_minutes))}\nDuración: ${confirmation.duration_minutes} minutos\nZona horaria: ${confirmation.time_zone}\n\nResponde “Confirmar” para guardarla o “Cancelar” para descartarla.`;
          } else if (req.body.kind === "created") {
            const { rows } = await client.query(
              `SELECT to_char(a.local_start, 'DD/MM/YYYY') AS local_date,
                      to_char(a.local_start, 'HH24:MI') AS local_time,
                      a.start_utc_offset_minutes, a.time_zone, a.agent_account_id,
                      extract(epoch FROM (a.end_at - a.start_at))::int / 60 AS duration_minutes
                 FROM reto.chat_appointments AS a
                 JOIN reto.chat_actions AS action
                   ON action.conversation_id = a.conversation_id
                  AND action.actor_account_id = $4
                  AND action.action_type = 'appointment.created'
                  AND action.outcome = 'succeeded'
                  AND action.entity_id = a.id::text
                WHERE a.id = $1 AND a.conversation_id = $2
                  AND a.client_document_path = $3 AND a.client_record_id = $5
                  AND a.status = 'confirmed'
                ORDER BY action.occurred_at DESC LIMIT 1`,
              [req.body.appointmentId, conversation.id, conversation.active_client_path, principal.accountId, conversation.active_client_record_id],
            );
            const appointment = rows[0];
            if (!appointment || !(await isAuthorizedAppointmentAgent(client, principal, appointment.agent_account_id)))
              return { state: "appointment_not_found" as const };
            response = `La cita quedó guardada en la agenda.\nCliente: ${profile.name || "Cliente activo"}\nAgente: ${agentName}\nFecha y hora: ${formatAppointmentLocalStart(appointment.local_date, appointment.local_time, Number(appointment.start_utc_offset_minutes))}\nDuración: ${appointment.duration_minutes} minutos\nZona horaria: ${appointment.time_zone}.`;
          } else if (req.body.kind === "appointments_list") {
            const { rows } = await client.query(
              `SELECT id, agent_account_id,
                      to_char(local_start, 'DD/MM/YYYY') AS local_date,
                      to_char(local_start, 'HH24:MI') AS local_time,
                      start_utc_offset_minutes, time_zone,
                      extract(epoch FROM (end_at - start_at))::int / 60 AS duration_minutes
                 FROM reto.chat_appointments
                WHERE client_document_path = $1
                  AND client_record_id = $2
                  AND status = 'confirmed'
                ORDER BY start_at, id`,
              [conversation.active_client_path, conversation.active_client_record_id],
            );
            const appointments = [];
            for (const appointment of rows) {
              if (await isAuthorizedAppointmentAgent(client, principal, appointment.agent_account_id))
                appointments.push(appointment);
            }
            response = appointments.length
              ? `Estas son las citas confirmadas del cliente activo:\n${appointments.map((appointment: { local_date: string; local_time: string; start_utc_offset_minutes: number; duration_minutes: number; time_zone: string }) => `• ${formatAppointmentLocalStart(appointment.local_date, appointment.local_time, Number(appointment.start_utc_offset_minutes))} · ${appointment.duration_minutes} minutos · ${appointment.time_zone}`).join("\n")}`
              : "No hay citas confirmadas para el cliente activo.";
          }

          if (req.body.kind === "request_details" || req.body.kind === "invalid_details" || req.body.kind === "conflict") {
            await client.query(
              `INSERT INTO reto.chat_appointment_chat_state(
                 conversation_id, requested_by_account_id, client_document_path,
                 client_record_id, stage, confirmation_id, updated_at
               ) VALUES ($1, $2, $3, $4, 'details', NULL, now())
               ON CONFLICT (conversation_id) DO UPDATE SET
                 requested_by_account_id = excluded.requested_by_account_id,
                 client_document_path = excluded.client_document_path,
                 client_record_id = excluded.client_record_id,
                 stage = 'details', confirmation_id = NULL, updated_at = now()`,
              [conversation.id, principal.accountId, conversation.active_client_path, conversation.active_client_record_id],
            );
          } else if (req.body.kind === "review" || req.body.kind === "repeat_confirmation") {
            await client.query(
              `INSERT INTO reto.chat_appointment_chat_state(
                 conversation_id, requested_by_account_id, client_document_path,
                 client_record_id, stage, confirmation_id, updated_at
               ) VALUES ($1, $2, $3, $4, 'confirmation', $5, now())
               ON CONFLICT (conversation_id) DO UPDATE SET
                 requested_by_account_id = excluded.requested_by_account_id,
                 client_document_path = excluded.client_document_path,
                 client_record_id = excluded.client_record_id,
                 stage = 'confirmation', confirmation_id = excluded.confirmation_id,
                 updated_at = now()`,
              [conversation.id, principal.accountId, conversation.active_client_path, conversation.active_client_record_id, req.body.confirmationId],
            );
          } else if (req.body.kind === "cancelled" || req.body.kind === "created") {
            await client.query(
              `DELETE FROM reto.chat_appointment_chat_state
                WHERE conversation_id = $1 AND requested_by_account_id = $2`,
              [conversation.id, principal.accountId],
            );
          }

          const userMessage = await client.query(
            `INSERT INTO reto.chat_messages(conversation_id, sender_role, content, client_document_path, client_record_id)
             VALUES ($1, 'user', $2, $3, $4)
             RETURNING id, sequence_no, sender_role, content, created_at`,
            [conversation.id, content, conversation.active_client_path, conversation.active_client_record_id],
          );
          const assistantMessage = await client.query(
            `INSERT INTO reto.chat_messages(conversation_id, sender_role, content, client_document_path, client_record_id)
            VALUES ($1, 'assistant', $2, $3, $4)
             RETURNING id, sequence_no, sender_role, content, created_at`,
            [conversation.id, response, conversation.active_client_path, conversation.active_client_record_id],
          );
          await client.query("UPDATE reto.chat_conversations SET updated_at = now() WHERE id = $1", [conversation.id]);
          return { state: "saved" as const, messages: [userMessage.rows[0], assistantMessage.rows[0]] };
        },
      );
      if (!result.authenticated) return reply.code(401).send({ error: "unauthorized", message: "Inicia sesión para continuar." });
      if (!result.authorized) return reply.code(404).send({ error: "not_found", message: "Conversación no encontrada." });
      if (result.result.state === "archived") return reply.code(409).send({ error: "conversation_archived", message: "No se puede agendar en una conversación archivada." });
      if (result.result.state === "agent_only") return reply.code(403).send({ error: "forbidden", message: "La agenda por chat está disponible para agentes." });
      if (result.result.state === "client_not_selected") return reply.code(409).send({ error: "client_not_selected", message: "Selecciona un cliente antes de crear una cita." });
      if (result.result.state === "client_not_found" || result.result.state === "confirmation_not_found" || result.result.state === "appointment_not_found" || result.result.state === "conflict_not_found")
        return reply.code(404).send({ error: "not_found", message: "No se encontró el cliente o la confirmación vigente." });
      if (result.result.state === "context_changed")
        return reply.code(409).send({ error: "context_changed", message: "Cambió el cliente activo. Vuelve a iniciar la solicitud de cita." });
      return reply.code(201).send({ messages: result.result.messages });
    },
  );

}
