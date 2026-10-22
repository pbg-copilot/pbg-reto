import { createHash } from "node:crypto";
import type { AppointmentExecution, AppointmentExecutionOutcome, ExecuteAppointmentCommand } from "../domain/appointment-execution.js";
import { appointmentTargetFingerprint, publicAppointment } from "../presentation/appointment-presenter.js";
import type { AppointmentExecutionAccess, AppointmentExecutionAudit, AppointmentExecutionAuditEntry, AppointmentExecutionRepository, AppointmentExecutionTransactions } from "./appointment-execution-ports.js";

export class AppointmentExecutionService implements AppointmentExecution {
  constructor(
    private readonly transactions: AppointmentExecutionTransactions,
    private readonly repository: AppointmentExecutionRepository,
    private readonly access: AppointmentExecutionAccess,
    private readonly audit: AppointmentExecutionAudit,
    private readonly now: () => number = Date.now,
  ) {}

  execute(command: ExecuteAppointmentCommand) {
    const idempotencyFingerprint = createHash("sha256")
      .update(JSON.stringify({ confirmationId: command.confirmationId })).digest("hex");
    return this.transactions.run<AppointmentExecutionOutcome>(command.tokenHash, command.conversationId,
      async (client, conversation, principal) => {
        const prior = await this.repository.lockIdempotency(client, principal.accountId, command.idempotencyKey);
        if (prior) {
          if (prior.conversation_id !== conversation.id || prior.idempotency_fingerprint !== idempotencyFingerprint)
            return { state: "idempotency_key_reused" };
          return { state: "replayed", outcome: prior.outcome, errorCode: prior.error_code, resultSnapshot: prior.result_snapshot };
        }

        if (conversation.status !== "active") return { state: "archived" };
        const clientPath = conversation.active_client_path;
        const clientRecordId = conversation.active_client_record_id;
        if (!clientPath || !clientRecordId) return { state: "client_not_selected" };
        if (!await this.access.hasClient(client, principal, clientPath, clientRecordId)) return { state: "client_not_found" };

        const confirmation = await this.repository.findConfirmation(client, command.confirmationId, conversation.id, principal.accountId);
        if (!confirmation) return { state: "invalid_confirmation" };
        const actionType = confirmation.action === "create" ? "appointment.created"
          : confirmation.action === "reschedule" ? "appointment.rescheduled" : "appointment.cancelled";
        const entityId = confirmation.appointment_id ?? confirmation.agent_account_id;
        const record = (outcome: AppointmentExecutionAuditEntry["outcome"], targetId: string,
          errorCode: string | null, resultSnapshot: AppointmentExecutionAuditEntry["resultSnapshot"]) =>
          this.audit.record(client, principal, {
            conversationId: conversation.id, actionType, entityId: targetId, outcome, errorCode,
            idempotencyKey: command.idempotencyKey, idempotencyFingerprint, resultSnapshot,
          });
        const reject = async (error: string, message: string): Promise<AppointmentExecutionOutcome> => {
          await this.repository.invalidateConfirmation(client, confirmation.id);
          const resultSnapshot = { error, message, action: confirmation.action };
          await record("rejected", entityId, error, resultSnapshot);
          return { state: "rejected", resultSnapshot };
        };

        if (confirmation.status !== "pending") return { state: "confirmation_already_used" };
        if (new Date(confirmation.expires_at).getTime() <= this.now())
          return reject("confirmation_expired", "La confirmación venció; prepara la cita nuevamente.");
        if (confirmation.client_document_path !== clientPath || confirmation.client_record_id !== clientRecordId)
          return reject("stale_confirmation", "Cambió el cliente activo; confirma nuevamente los datos de la cita.");
        if (!await this.access.canManageAgent(client, principal, confirmation.agent_account_id))
          return reject("stale_confirmation", "El agente ya no está dentro de tu alcance; prepara la cita nuevamente.");

        if (confirmation.appointment_id) {
          const target = await this.repository.findTarget(client, confirmation.appointment_id, conversation.id, clientPath, clientRecordId);
          if (!target || appointmentTargetFingerprint(target) !== confirmation.target_fingerprint ||
              !await this.access.canManageAgent(client, principal, target.agent_account_id))
            return reject("stale_confirmation", "La cita cambió desde la confirmación; revisa y confirma de nuevo.");
        }

        const written = await this.repository.write(client, confirmation, conversation.id, principal.accountId);
        if (written.state === "conflict") {
          await this.repository.invalidateConfirmation(client, confirmation.id);
          const resultSnapshot = {
            error: "slot_taken", message: "El intervalo se cruzó con otra cita confirmada. No se guardaron cambios.",
            action: confirmation.action,
          };
          await record("conflict", entityId, "slot_taken", resultSnapshot);
          return { state: "conflict", resultSnapshot };
        }

        await this.repository.consumeConfirmation(client, confirmation.id);
        const resultSnapshot = { action: confirmation.action, appointment: publicAppointment(written.appointment) };
        await record("succeeded", written.appointment.id, null, resultSnapshot);
        return { state: "succeeded", resultSnapshot };
      });
  }
}
