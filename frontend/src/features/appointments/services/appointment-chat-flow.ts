import { ApiError, type ApiRequest } from "../../../shared/api/api-client";
import type { Agent, AppointmentChatKind, AppointmentChatStage, AppointmentConfirmation, AppointmentMutationResult, Client } from "../../../shared/types/domain";
import { parseAppointmentDetails, type PendingAppointment } from "../domain/appointment-domain";
import { executeAppointment, prepareAppointment } from "./appointment-api";

export type AppointmentChatFlowContext = {
  api: ApiRequest;
  agent: Agent | null;
  conversationId: string;
  client: Client;
  content: string;
  isCurrent: () => boolean;
  sendTurn: (kind: AppointmentChatKind, extra?: { confirmationId?: string; appointmentId?: string }) => Promise<void>;
  loadAppointments: () => Promise<void>;
};

export type AppointmentChatFlowEffects = {
  setAppointmentChatStage: (stage: AppointmentChatStage) => void;
  setPendingAppointment: (pending: PendingAppointment) => void;
  setAppointmentBusy: (busy: boolean) => void;
  setAppointmentResult: (result: AppointmentMutationResult) => void;
  setConversationError: (message: string) => void;
};

export async function collectAppointmentDetails(context: AppointmentChatFlowContext, effects: AppointmentChatFlowEffects): Promise<void> {
  const { api, agent, conversationId, client, content } = context;
  if (agent?.role !== "agent") {
    effects.setConversationError("La creación de citas por chat está disponible para cuentas de agente.");
    effects.setAppointmentChatStage("idle");
    return;
  }
  if (/^(cancelar|cancel|olvidalo|olvídalo)\b/i.test(content.trim())) {
    await context.sendTurn("cancelled");
    if (context.isCurrent()) effects.setAppointmentChatStage("idle");
    return;
  }
  const details = parseAppointmentDetails(content);
  if (!details) { await context.sendTurn("invalid_details"); return; }
  effects.setAppointmentBusy(true);
  let prepared: { confirmation: AppointmentConfirmation };
  try {
    prepared = await prepareAppointment(api, conversationId, {
      action: "create", agentAccountId: agent.id, localStart: details.localStart,
      durationMinutes: details.durationMinutes, timeZone: details.timeZone,
    });
  } catch (error) {
    if (!context.isCurrent()) return;
    if (error instanceof ApiError && (error.status === 400 || error.status === 409) && error.code !== "context_changed") {
      await context.sendTurn("invalid_details");
      return;
    }
    throw error;
  }
  if (!context.isCurrent()) return;
  if (prepared.confirmation.client_document_path !== client.document_path || prepared.confirmation.client_record_id !== client.client_record_id)
    throw new ApiError("Cambió el cliente activo. Vuelve a iniciar la solicitud de cita.", 409, "context_changed");
  effects.setPendingAppointment({ confirmation: prepared.confirmation, idempotencyKey: prepared.confirmation.id });
  effects.setAppointmentChatStage("confirmation");
  await context.sendTurn("review", { confirmationId: prepared.confirmation.id });
}

export async function confirmAppointmentFromChat(context: AppointmentChatFlowContext, pending: PendingAppointment, effects: AppointmentChatFlowEffects): Promise<void> {
  const { api, conversationId, content } = context;
  if (/^(cancelar|cancel|no|descartar)\b/i.test(content.trim())) {
    await context.sendTurn("cancelled");
    if (context.isCurrent()) { effects.setAppointmentChatStage("idle"); effects.setPendingAppointment(null); }
    return;
  }
  if (!/^(confirmar|confirmo|si|sí|acepto|guardar)\b/i.test(content.trim())) {
    if (pending) await context.sendTurn("repeat_confirmation", { confirmationId: pending.confirmation.id });
    else effects.setConversationError("No hay una confirmación de cita vigente. Inicia una nueva solicitud.");
    return;
  }
  if (!pending) {
    effects.setConversationError("No hay una confirmación de cita vigente. Inicia una nueva solicitud.");
    effects.setAppointmentChatStage("idle");
    return;
  }
  effects.setAppointmentBusy(true);
  try {
    const created = await executeAppointment(api, conversationId, pending.confirmation.id, pending.idempotencyKey);
    if (!context.isCurrent()) return;
    effects.setAppointmentResult(created);
    effects.setPendingAppointment(null);
    effects.setAppointmentChatStage("idle");
    await context.loadAppointments();
    if (!context.isCurrent()) return;
    try {
      await context.sendTurn("created", { appointmentId: created.appointment.id });
    } catch {
      if (context.isCurrent()) effects.setConversationError("La cita quedó guardada y ya aparece en la agenda, pero no se pudo añadir el mensaje de confirmación al historial.");
    }
  } catch (error) {
    if (!context.isCurrent()) return;
    if (error instanceof ApiError && error.status === 409 && error.code === "slot_taken") {
      effects.setPendingAppointment(null);
      effects.setAppointmentChatStage("details");
      await context.sendTurn("conflict");
    } else throw error;
  }
}
