import { useState } from "react";
import type { Appointment, AppointmentAction } from "../../../shared/types/domain";
import { buildAppointmentPreparePayload } from "../domain/appointment-form";
import { executeAppointment as executeAppointmentRequest, prepareAppointment as prepareAppointmentRequest } from "../services/appointment-api";
import type { AppointmentContextGuard, AppointmentWorkflowOptions, LoadAppointments } from "./appointment-workflow-types";
import type { AppointmentOperation } from "./useAppointmentOperation";
import { ApiError } from "../../../shared/api/api-client";

export function useAppointmentForm(options: AppointmentWorkflowOptions, operation: AppointmentOperation, appointments: Appointment[], loadAppointments: LoadAppointments, isCurrent: AppointmentContextGuard) {
  const [appointmentAction, setAppointmentAction] = useState<AppointmentAction>("create");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [appointmentDuration, setAppointmentDuration] = useState(30);
  const { appointmentBusy, setAppointmentBusy, setAppointmentError, setAppointmentConflict,
    pendingAppointment, setPendingAppointment, setAppointmentResult, appointmentRequest } = operation;
  function reset() {
    setAppointmentAction("create"); setSelectedAppointmentId(""); setAppointmentDate("");
    setAppointmentTime(""); setAppointmentDuration(30);
  }
  async function prepareAppointment() {
    if (!options.activeConversationId || !options.activeClient || options.agent?.role !== "agent" || appointmentBusy) return;
    const conversationId = options.activeConversationId;
    const requestId = options.contextRequest.current;
    const prepared = buildAppointmentPreparePayload({
      action: appointmentAction, appointment: appointments.find((item) => item.id === selectedAppointmentId),
      agentAccountId: options.agent.id, date: appointmentDate, time: appointmentTime, durationMinutes: appointmentDuration,
    });
    if (!prepared.valid) { setAppointmentError(prepared.message); return; }
    const payload = prepared.payload;
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
    appointmentAction, setAppointmentAction, selectedAppointmentId, setSelectedAppointmentId,
    appointmentDate, setAppointmentDate, appointmentTime, setAppointmentTime, appointmentDuration, setAppointmentDuration,
    prepareAppointment, executeAppointment, reset,
  };
}
