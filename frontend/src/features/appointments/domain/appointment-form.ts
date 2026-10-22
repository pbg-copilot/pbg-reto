import type { Appointment, AppointmentAction } from "../../../shared/types/domain";
import type { AppointmentPreparePayload } from "../services/appointment-api";

type FormInput = {
  action: AppointmentAction;
  appointment?: Appointment;
  agentAccountId: string;
  date: string;
  time: string;
  durationMinutes: number;
};

type FormPreparation = { valid: true; payload: AppointmentPreparePayload } | { valid: false; message: string };

export function buildAppointmentPreparePayload(input: FormInput): FormPreparation {
  const { action, appointment, agentAccountId, date, time, durationMinutes } = input;
  if (action !== "create" && !appointment)
    return { valid: false, message: "Selecciona una cita vigente para continuar." };
  if (action !== "cancel" && (!date || !time))
    return { valid: false, message: "Indica la fecha y la hora local de la cita." };

  const payload: AppointmentPreparePayload = { action };
  if (action !== "create" && appointment) payload.appointmentId = appointment.id;
  if (action === "create") payload.agentAccountId = agentAccountId;
  if (action !== "cancel") {
    payload.localStart = `${date}T${time}`;
    payload.durationMinutes = durationMinutes;
    payload.timeZone = "America/Bogota";
    if (action === "reschedule" && appointment) payload.agentAccountId = appointment.agent_account_id;
  }
  return { valid: true, payload };
}
