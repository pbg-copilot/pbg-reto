import type { AppointmentChat, AppointmentChatCommand, AppointmentChatOutcome, AppointmentChatResult, AppointmentChatScope } from "../domain/appointment-chat.js";
import type { AppointmentChatAccess, AppointmentChatRepository, AppointmentChatTransactions } from "./appointment-chat-ports.js";
import { appointmentChatText, appointmentChatReview, appointmentChatCreated, appointmentChatList } from "../presentation/appointment-chat-text.js";

export class AppointmentChatService implements AppointmentChat {
  constructor(
    private readonly transactions: AppointmentChatTransactions,
    private readonly repository: AppointmentChatRepository,
    private readonly access: AppointmentChatAccess,
  ) {}

  async send(command: AppointmentChatCommand): Promise<AppointmentChatResult> {
    const body = command.body;
    const content = body.content.trim();
    if (!content) return { state: "empty_content" };
    const needsConfirmation = body.kind === "review" || body.kind === "repeat_confirmation";
    if (needsConfirmation !== (body.confirmationId !== undefined) ||
        (body.kind === "created") !== (body.appointmentId !== undefined))
      return { state: "invalid_details" };

    return this.transactions.run<AppointmentChatOutcome>(command.tokenHash, command.conversationId,
      async (client, conversation, principal) => {
        if (conversation.status !== "active") return { state: "archived" as const };
        if (principal.role !== "agent" && body.kind !== "appointments_list") return { state: "agent_only" as const };
        if (!conversation.active_client_path || !conversation.active_client_record_id)
          return { state: "client_not_selected" as const };
        if (conversation.active_client_path !== body.expectedClientPath ||
            conversation.active_client_record_id !== body.expectedClientRecordId)
          return { state: "context_changed" as const };
        const profile = await this.access.getProfile(client, principal, conversation.active_client_path, conversation.active_client_record_id);
        if (!profile) return { state: "client_not_found" as const };
        const scope: AppointmentChatScope = {
          conversationId: conversation.id, accountId: principal.accountId,
          clientPath: conversation.active_client_path, clientRecordId: conversation.active_client_record_id,
        };
        const savedAgentName = await this.repository.findAgentName(client, principal.accountId);
        const agentName = savedAgentName || "Agente conectado";
        let response = appointmentChatText.fallback;

        if (body.kind === "request_details") {
          response = appointmentChatText.requestDetails;
        } else if (body.kind === "invalid_details") {
          response = appointmentChatText.invalidDetails;
        } else if (body.kind === "cancelled") {
          response = appointmentChatText.cancelled;
        } else if (body.kind === "conflict") {
          const hasConflict = await this.repository.hasRecentConflict(client, scope);
          if (!hasConflict) return { state: "conflict_not_found" as const };
          response = appointmentChatText.conflict;
        } else if (needsConfirmation) {
          const confirmation = await this.repository.findConfirmation(client, scope, body.confirmationId!);
          if (!confirmation || confirmation.action !== "create" ||
              !(await this.access.canManageAgent(client, principal, confirmation.agent_account_id)))
            return { state: "confirmation_not_found" as const };
          response = appointmentChatReview(confirmation, profile.name || "Cliente activo", agentName);
        } else if (body.kind === "created") {
          const appointment = await this.repository.findCreatedAppointment(client, scope, body.appointmentId!);
          if (!appointment || !(await this.access.canManageAgent(client, principal, appointment.agent_account_id)))
            return { state: "appointment_not_found" as const };
          response = appointmentChatCreated(appointment, profile.name || "Cliente activo", agentName);
        } else if (body.kind === "appointments_list") {
          const rows = await this.repository.listAppointments(client, scope);
          const appointments = [];
          for (const appointment of rows) {
            if (await this.access.canManageAgent(client, principal, appointment.agent_account_id))
              appointments.push(appointment);
          }
          response = appointmentChatList(appointments);
        }

        if (body.kind === "request_details" || body.kind === "invalid_details" || body.kind === "conflict") {
          await this.repository.saveDetailsState(client, scope);
        } else if (body.kind === "review" || body.kind === "repeat_confirmation") {
          await this.repository.saveConfirmationState(client, scope, body.confirmationId!);
        } else if (body.kind === "cancelled" || body.kind === "created") {
          await this.repository.clearState(client, scope);
        }

        const messages = await this.repository.saveTurn(client, scope, content, response);
        return { state: "saved" as const, messages };
      },
    );
  }
}
