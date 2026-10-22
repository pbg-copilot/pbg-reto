import { useState } from "react";
import type { AppointmentChatKind, AppointmentChatStage, Client } from "../../../shared/types/domain";
import { isAppointmentListRequest, isCreateAppointmentRequest } from "../domain/appointment-domain";
import { getAppointmentChatState, sendAppointmentChatTurn } from "../services/appointment-api";
import type { AppointmentContextGuard, AppointmentWorkflowOptions, LoadAppointments } from "./appointment-workflow-types";
import type { AppointmentOperation } from "./useAppointmentOperation";
import { ApiError } from "../../../shared/api/api-client";
import { collectAppointmentDetails, confirmAppointmentFromChat, type AppointmentChatFlowContext, type AppointmentChatFlowEffects } from "../services/appointment-chat-flow";

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
        if (isCurrent(conversationId, requestId)) setAppointmentChatStage("details");
        return true;
      }
      if (listing) {
        await sendChatTurn(conversationId, requestId, client, content, "appointments_list");
        return true;
      }
      const context: AppointmentChatFlowContext = {
        api: options.api, agent: options.agent, conversationId, client, content,
        isCurrent: () => isCurrent(conversationId, requestId),
        sendTurn: (kind, extra) => sendChatTurn(conversationId, requestId, client, content, kind, extra),
        loadAppointments: () => loadAppointments(conversationId, requestId),
      };
      const effects: AppointmentChatFlowEffects = {
        setAppointmentChatStage, setPendingAppointment, setAppointmentBusy, setAppointmentResult,
        setConversationError: options.setConversationError,
      };
      if (appointmentChatStage === "details") await collectAppointmentDetails(context, effects);
      else if (appointmentChatStage === "confirmation") await confirmAppointmentFromChat(context, pendingAppointment, effects);
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
