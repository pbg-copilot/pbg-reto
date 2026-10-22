import { useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Agent, Appointment, AppointmentAction, AppointmentChatKind, AppointmentChatStage, AppointmentConfirmation, AppointmentMutationResult, Client, Conversation, Message } from "../domain";
import { ApiError } from "../api-client";
import { isAppointmentListRequest, isCreateAppointmentRequest, parseAppointmentDetails } from "../appointment-domain";
import {
  executeAppointment as executeAppointmentRequest,
  getAppointmentChatState,
  listAppointments,
  prepareAppointment as prepareAppointmentRequest,
  sendAppointmentChatTurn,
  type ApiRequest,
  type AppointmentPreparePayload,
} from "../appointment-api";

type Options = {
  api: ApiRequest;
  agent: Agent | null;
  activeConversationId: string;
  activeClient: Client | null;
  contextRequest: MutableRefObject<number>;
  activeConversationRef: MutableRefObject<string>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setMessageDraft: Dispatch<SetStateAction<string>>;
  setMessageBusy: Dispatch<SetStateAction<boolean>>;
  setConversationError: Dispatch<SetStateAction<string>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
};

export function useAppointmentWorkflow(options: Options) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState("");
  const [appointmentError, setAppointmentError] = useState("");
  const [appointmentConflict, setAppointmentConflict] = useState(false);
  const [appointmentBusy, setAppointmentBusy] = useState(false);
  const [appointmentAction, setAppointmentAction] = useState<AppointmentAction>("create");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [appointmentDuration, setAppointmentDuration] = useState(30);
  const [pendingAppointment, setPendingAppointment] = useState<{ confirmation: AppointmentConfirmation; idempotencyKey: string } | null>(null);
  const [appointmentResult, setAppointmentResult] = useState<AppointmentMutationResult | null>(null);
  const [appointmentChatStage, setAppointmentChatStage] = useState<AppointmentChatStage>("idle");
  const appointmentRequest = useRef(0);
  const isCurrent = (conversationId: string, requestId: number) => requestId === options.contextRequest.current && conversationId === options.activeConversationRef.current;

  function reset() {
    appointmentRequest.current += 1;
    setAppointments([]); setAppointmentsLoading(false); setAppointmentsError("");
    setAppointmentError(""); setAppointmentConflict(false); setAppointmentBusy(false);
    setAppointmentAction("create"); setSelectedAppointmentId(""); setAppointmentDate("");
    setAppointmentTime(""); setAppointmentDuration(30); setPendingAppointment(null);
    setAppointmentResult(null); setAppointmentChatStage("idle");
  }

  async function loadAppointments(conversationId: string, requestId = options.contextRequest.current) {
    setAppointmentsLoading(true); setAppointmentsError("");
    try {
      const appointments = await listAppointments(options.api, conversationId);
      if (isCurrent(conversationId, requestId)) setAppointments(appointments);
    } catch (error) {
      if (isCurrent(conversationId, requestId) && !(error instanceof ApiError && error.status === 401))
        setAppointmentsError(error instanceof Error ? error.message : "No se pudieron cargar las citas.");
    } finally { if (isCurrent(conversationId, requestId)) setAppointmentsLoading(false); }
  }

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

  function invalidateReview() {
    appointmentRequest.current += 1;
    setPendingAppointment(null); setAppointmentResult(null); setAppointmentError(""); setAppointmentConflict(false);
  }

  async function prepareAppointment() {
    if (!options.activeConversationId || !options.activeClient || options.agent?.role !== "agent" || appointmentBusy) return;
    const conversationId = options.activeConversationId;
    const requestId = options.contextRequest.current;
    const appointment = appointments.find((item) => item.id === selectedAppointmentId);
    if (appointmentAction !== "create" && !appointment) { setAppointmentError("Selecciona una cita vigente para continuar."); return; }
    if (appointmentAction !== "cancel" && (!appointmentDate || !appointmentTime)) { setAppointmentError("Indica la fecha y la hora local de la cita."); return; }
    const payload: AppointmentPreparePayload = { action: appointmentAction };
    if (appointmentAction !== "create") payload.appointmentId = appointment!.id;
    if (appointmentAction === "create") payload.agentAccountId = options.agent.id;
    if (appointmentAction !== "cancel") {
      payload.localStart = `${appointmentDate}T${appointmentTime}`;
      payload.durationMinutes = appointmentDuration;
      payload.timeZone = "America/Bogota";
      if (appointmentAction === "reschedule") payload.agentAccountId = appointment!.agent_account_id;
    }
    const operationId = ++appointmentRequest.current;
    setAppointmentBusy(true); setAppointmentError(""); setAppointmentConflict(false); setAppointmentResult(null); setPendingAppointment(null);
    try {
      const result = await prepareAppointmentRequest(options.api, conversationId, payload);
      if (operationId === appointmentRequest.current && isCurrent(conversationId, requestId))
        setPendingAppointment({ confirmation: result.confirmation, idempotencyKey: crypto.randomUUID() });
    } catch (error) {
      if (operationId === appointmentRequest.current && isCurrent(conversationId, requestId) && !(error instanceof ApiError && error.status === 401))
        setAppointmentError(error instanceof Error ? error.message : "No se pudo preparar la operación.");
    } finally { if (operationId === appointmentRequest.current) setAppointmentBusy(false); }
  }

  async function executeAppointment() {
    if (!options.activeConversationId || !pendingAppointment || appointmentBusy) return;
    const conversationId = options.activeConversationId;
    const requestId = options.contextRequest.current;
    const operationId = appointmentRequest.current;
    const pending = pendingAppointment;
    setAppointmentBusy(true); setAppointmentError(""); setAppointmentConflict(false); setAppointmentResult(null);
    try {
      const result = await executeAppointmentRequest(
        options.api,
        conversationId,
        pending.confirmation.id,
        pending.idempotencyKey,
      );
      if (operationId === appointmentRequest.current && isCurrent(conversationId, requestId)) {
        setAppointmentResult(result); setPendingAppointment(null); setAppointmentAction("create"); setSelectedAppointmentId("");
        await loadAppointments(conversationId, requestId);
      }
    } catch (error) {
      if (operationId === appointmentRequest.current && isCurrent(conversationId, requestId) && !(error instanceof ApiError && error.status === 401)) {
        if (error instanceof ApiError && error.status === 409) { setPendingAppointment(null); setAppointmentConflict(error.code === "slot_taken"); }
        setAppointmentError(error instanceof Error ? error.message : "No se pudo completar la operación.");
      }
    } finally { if (operationId === appointmentRequest.current) setAppointmentBusy(false); }
  }

  return {
    appointments, appointmentsLoading, appointmentsError, appointmentError, setAppointmentError,
    appointmentConflict, setAppointmentConflict, appointmentBusy, setAppointmentBusy,
    appointmentAction, setAppointmentAction, selectedAppointmentId, setSelectedAppointmentId,
    appointmentDate, setAppointmentDate, appointmentTime, setAppointmentTime,
    appointmentDuration, setAppointmentDuration, pendingAppointment, setPendingAppointment,
    appointmentResult, setAppointmentResult, appointmentChatStage, setAppointmentChatStage,
    reset, loadAppointments, restoreChatState, handleChat, invalidateReview,
    prepareAppointment, executeAppointment,
  };
}
