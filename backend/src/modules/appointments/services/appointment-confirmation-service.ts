import { LocalDateTimeError, resolveLocalDateTime } from "../../../shared/time/timezones.js";
import type { AppointmentConfirmation, AppointmentConfirmationOutcome, AppointmentConfirmationTarget, PrepareAppointmentConfirmationCommand, PrepareAppointmentConfirmationResult } from "../domain/appointment-confirmation.js";
import type { AppointmentConfirmationAccess, AppointmentConfirmationRepository, AppointmentConfirmationTransactions } from "./appointment-confirmation-ports.js";
import { appointmentTargetFingerprint } from "../presentation/appointment-presenter.js";

export class AppointmentConfirmationService implements AppointmentConfirmation {
  constructor(
    private readonly transactions: AppointmentConfirmationTransactions,
    private readonly repository: AppointmentConfirmationRepository,
    private readonly access: AppointmentConfirmationAccess,
  ) {}

  async prepare(command: PrepareAppointmentConfirmationCommand): Promise<PrepareAppointmentConfirmationResult> {
    const body = command.body;
    const hasSchedule =
      body.localStart !== undefined ||
      body.durationMinutes !== undefined ||
      body.timeZone !== undefined ||
      body.utcOffsetMinutes !== undefined;
    const validShape =
      body.action === "create"
        ? body.appointmentId === undefined &&
          body.agentAccountId !== undefined &&
          body.localStart !== undefined &&
          body.durationMinutes !== undefined &&
          body.timeZone !== undefined
        : body.action === "reschedule"
          ? body.appointmentId !== undefined &&
            body.localStart !== undefined &&
            body.durationMinutes !== undefined &&
            body.timeZone !== undefined
          : body.appointmentId !== undefined &&
            body.agentAccountId === undefined &&
            !hasSchedule;

    if (!validShape) return { state: "invalid_shape" };

    let requestedInterval: ReturnType<typeof resolveLocalDateTime> | undefined;
    if (body.action !== "cancel") {
      try {
        requestedInterval = resolveLocalDateTime(
          body.localStart!, body.timeZone!, body.durationMinutes!, body.utcOffsetMinutes,
        );
      } catch (error) {
        if (!(error instanceof LocalDateTimeError)) throw error;
        return { state: "local_time_error", error };
      }
    }

    return this.transactions.run<AppointmentConfirmationOutcome>(
      command.tokenHash, command.conversationId,
      async (client, conversation, principal) => {
        if (conversation.status !== "active")
          return { state: "archived" as const };
        if (!conversation.active_client_path || !conversation.active_client_record_id)
          return { state: "client_not_selected" as const };
        if (!await this.access.hasClient(
          client, principal, conversation.active_client_path, conversation.active_client_record_id,
        )) return { state: "client_not_found" as const };

        let target: AppointmentConfirmationTarget | undefined;
        if (body.action !== "create") {
          target = await this.repository.findTarget(
            client, body.appointmentId!, conversation.id,
            conversation.active_client_path, conversation.active_client_record_id,
          );
          if (!target) return { state: "appointment_not_found" as const };
          if (
            !(await this.access.canManageAgent(
              client,
              principal,
              target.agent_account_id,
            ))
          )
            return { state: "appointment_not_found" as const };
        }

        const agentAccountId =
          body.action === "cancel"
            ? target!.agent_account_id
            : body.action === "reschedule"
              ? body.agentAccountId ?? target!.agent_account_id
              : body.agentAccountId!;
        if (
          !(await this.access.canManageAgent(
            client,
            principal,
            agentAccountId,
          ))
        )
          return { state: "agent_not_found" as const };

        let interval = requestedInterval;
        let localStart = body.localStart;
        let targetFingerprint: string | null = null;
        if (target) {
          targetFingerprint = appointmentTargetFingerprint(target);
          if (body.action === "cancel") {
            localStart = String(target.local_start);
            const durationMinutes =
              (new Date(target.end_at).getTime() -
                new Date(target.start_at).getTime()) /
              60_000;
            try {
              interval = resolveLocalDateTime(
                localStart,
                target.time_zone,
                durationMinutes,
                Number(target.start_utc_offset_minutes),
              );
            } catch {
              return { state: "appointment_not_found" as const };
            }
          }
        }
        if (!interval || !localStart)
          return { state: "invalid_request" as const };

        const confirmation = await this.repository.insert(client, {
          conversationId: conversation.id,
          requestedByAccountId: principal.accountId,
          action: body.action,
          appointmentId: target?.id ?? null,
          clientDocumentPath: conversation.active_client_path,
          clientRecordId: conversation.active_client_record_id,
          agentAccountId, interval, localStart, targetFingerprint,
        });
        return {
          state: "confirmed_for_review" as const,
          confirmation: {
            id: confirmation.id,
            expiresAt: confirmation.expires_at,
            action: body.action,
            appointmentId: target?.id ?? null,
            clientDocumentPath: conversation.active_client_path,
            clientRecordId: conversation.active_client_record_id,
            agentAccountId,
            interval,
          },
        };
      },
    );
  }
}
