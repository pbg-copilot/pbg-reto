import { useState } from "react";
import type { Appointment } from "../../../shared/types/domain";
import { listAppointments } from "../services/appointment-api";
import type { AppointmentContextGuard, AppointmentWorkflowOptions } from "./appointment-workflow-types";
import { ApiError } from "../../../shared/api/api-client";

export function useAppointmentList(options: Pick<AppointmentWorkflowOptions, "api" | "contextRequest">, isCurrent: AppointmentContextGuard) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState("");
  function reset() { setAppointments([]); setAppointmentsLoading(false); setAppointmentsError(""); }
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
  return { appointments, appointmentsLoading, appointmentsError, loadAppointments, reset };
}
