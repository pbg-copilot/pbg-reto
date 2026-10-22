import { useState } from "react";
import type { AppointmentChatKind, AppointmentChatStage, AppointmentConfirmation, Client } from "../../../shared/types/domain";
import { isAppointmentListRequest, isCreateAppointmentRequest, parseAppointmentDetails } from "../domain/appointment-domain";
import { executeAppointment as executeAppointmentRequest, getAppointmentChatState, prepareAppointment as prepareAppointmentRequest, sendAppointmentChatTurn } from "../services/appointment-api";
import type { AppointmentContextGuard, AppointmentWorkflowOptions, LoadAppointments } from "./appointment-workflow-types";
import type { AppointmentOperation } from "./useAppointmentOperation";
import { ApiError } from "../../../shared/api/api-client";

export function useAppointmentChat(options: AppointmentWorkflowOptions, operation: AppointmentOperation, loadAppointments: LoadAppointments, isCurrent: AppointmentContextGuard) {
  const [appointmentChatStage, setAppointmentChatStage] = useState<AppointmentChatStage>("idle");
  const { pendingAppointment, setPendingAppointment, setAppointmentBusy, setAppointmentResult } = operation;
  function reset() { setAppointmentChatStage("idle"); }
  async function sendChatTurn(conversationId: string, requestId: number, client: Client, content: string, kind: AppointmentChatKind, extra: { confirmationId?: string; appointmentId?: string } = {}) {
    const result = await sendAppointmentChatTurn(options.api, conversationId, {
      content,
      kind,
      expectedClientPath: client.document_path,
      expectedClientRecordId: client.client_record_id,
      ...extra,
    });
    if (!isCurrent(conversationId, requestId)) return;
    options.setMessages((current) => [...current, ...result.messages]);
    options.setMessageDraft("");
    const updatedAt = result.messages[result.messages.length - 1]?.created_at;
    if (updatedAt) options.setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, updated_at: updatedAt } : item));
  }

  async function restoreChatState(conversationId: string, requestId: number) {
    try {
      const state = await getAppointmentChatState(options.api, conversationId);
      if (!isCurrent(conversationId, requestId)) return;
      if (state.state === "details") setAppointmentChatStage("details");
      else if (state.state === "confirmation" && state.confirmation) {
        setAppointmentChatStage("confirmation");
        setPendingAppointment({ confirmation: state.confirmation, idempotencyKey: state.confirmation.id });
      }
    } catch (error) {
      if (isCurrent(conversationId, requestId) && !(error instanceof ApiError && error.status === 401))
        options.setConversationError(error instanceof Error ? error.message : "No se pudo recuperar la solicitud de cita pendiente.");
    }
  }

  async function handleChat(content: string): Promise<boolean> {
    const starting = appointmentChatStage === "idle" && isCreateAppointmentRequest(content);
    const listing = appointmentChatStage === "idle" && isAppointmentListRequest(content);
    if (!starting && !listing && appointmentChatStage === "idle") return false;
    const conversationId = options.activeConversationId;
    const requestId = options.contextRequest.current;
    const client = options.activeClient;
    if (!conversationId || !client) return true;
    if (starting && options.agent?.role !== "agent") {
      options.setConversationError("La creación de citas por chat está disponible para cuentas de agente.");
      return true;
    }
    options.setMessageBusy(true); options.setConversationError(""); options.setNotice("");
    try {
      if (starting) {
        await sendChatTurn(conversationId, requestId, client, content, "request_details");
        if (requestId === options.contextRequest.current) setAppointmentChatStage("details");
        return true;
      }
      if (listing) {
        await sendChatTurn(conversationId, requestId, client, content, "appointments_list");
        return true;
      }
      if (appointmentChatStage === "details") {
        if (options.agent?.role !== "agent") {
          options.setConversationError("La creación de citas por chat está disponible para cuentas de agente.");
          setAppointmentChatStage("idle");
          return true;
        }
        if (/^(cancelar|cancel|olvidalo|olvídalo)\b/i.test(content.trim())) {
          await sendChatTurn(conversationId, requestId, client, content, "cancelled");
          if (requestId === options.contextRequest.current) setAppointmentChatStage("idle");
          return true;
        }
        const details = parseAppointmentDetails(content);
        if (!details) {
          await sendChatTurn(conversationId, requestId, client, content, "invalid_details");
          return true;
        }
        setAppointmentBusy(true);
        let prepared: { confirmation: AppointmentConfirmation };
        try {
          prepared = await prepareAppointmentRequest(options.api, conversationId, {
            action: "create",
            agentAccountId: options.agent.id,
            localStart: details.localStart,
            durationMinutes: details.durationMinutes,
            timeZone: details.timeZone,
          });
        } catch (error) {
          if (error instanceof ApiError && (error.status === 400 || error.status === 409) && error.code !== "context_changed") {
            await sendChatTurn(conversationId, requestId, client, content, "invalid_details");
            return true;
          }
          throw error;
        }
        if (prepared.confirmation.client_document_path !== client.document_path || prepared.confirmation.client_record_id !== client.client_record_id)
          throw new ApiError("Cambió el cliente activo. Vuelve a iniciar la solicitud de cita.", 409, "context_changed");
        if (!isCurrent(conversationId, requestId)) return true;
        setPendingAppointment({ confirmation: prepared.confirmation, idempotencyKey: prepared.confirmation.id });
        setAppointmentChatStage("confirmation");
        await sendChatTurn(conversationId, requestId, client, content, "review", { confirmationId: prepared.confirmation.id });
        return true;
      }
      if (appointmentChatStage === "confirmation") {
        const pending = pendingAppointment;
        if (/^(cancelar|cancel|no|descartar)\b/i.test(content.trim())) {
          await sendChatTurn(conversationId, requestId, client, content, "cancelled");
          if (requestId === options.contextRequest.current) { setAppointmentChatStage("idle"); setPendingAppointment(null); }
          return true;
        }
        if (!/^(confirmar|confirmo|si|sí|acepto|guardar)\b/i.test(content.trim())) {
          if (pending) await sendChatTurn(conversationId, requestId, client, content, "repeat_confirmation", { confirmationId: pending.confirmation.id });
          else options.setConversationError("No hay una confirmación de cita vigente. Inicia una nueva solicitud.");
          return true;
        }
        if (!pending) {
          options.setConversationError("No hay una confirmación de cita vigente. Inicia una nueva solicitud.");
          setAppointmentChatStage("idle");
          return true;
        }
        setAppointmentBusy(true);
        try {
          const created = await executeAppointmentRequest(
            options.api,
            conversationId,
            pending.confirmation.id,
            pending.idempotencyKey,
          );
          if (!isCurrent(conversationId, requestId)) return true;
          setAppointmentResult(created); setPendingAppointment(null); setAppointmentChatStage("idle");
          await loadAppointments(conversationId, requestId);
          try {
            await sendChatTurn(conversationId, requestId, client, content, "created", { appointmentId: created.appointment.id });
          } catch {
            options.setConversationError("La cita quedó guardada y ya aparece en la agenda, pero no se pudo añadir el mensaje de confirmación al historial.");
          }
        } catch (error) {
          if (error instanceof ApiError && error.status === 409 && error.code === "slot_taken") {
            setPendingAppointment(null); setAppointmentChatStage("details");
            await sendChatTurn(conversationId, requestId, client, content, "conflict");
          } else throw error;
        }
        return true;
      }
    } catch (error) {
      if (isCurrent(conversationId, requestId) && !(error instanceof ApiError && error.status === 401)) {
        options.setConversationError(error instanceof Error ? error.message : "No se pudo completar la solicitud de cita.");
        if (error instanceof ApiError && error.code === "context_changed") setAppointmentChatStage("idle");
      }
      return true;
    } finally { options.setMessageBusy(false); setAppointmentBusy(false); }
    return true;
  }
  return { appointmentChatStage, setAppointmentChatStage, handleChat, restoreChatState, reset };
}
