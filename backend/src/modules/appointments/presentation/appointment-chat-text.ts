import { formatAppointmentLocalStart } from "./appointment-presenter.js";
import type { AppointmentChatSummary } from "../domain/appointment-chat.js";

export const appointmentChatText = {
  fallback: "No pude completar la solicitud de cita.",
  requestDetails: "Claro. Indícame la fecha y hora local como AAAA-MM-DD HH:mm o DD/MM/AAAA HH:mm; por ejemplo, 2026-10-25 15:00 o 25/10/2026 15:00. Usaré America/Bogota y una duración de 30 minutos por defecto; puedes indicar otra duración en minutos. Antes de guardar te mostraré los datos para que los confirmes.",
  invalidDetails: "No pude validar esos datos. Envíame una fecha válida como AAAA-MM-DD HH:mm o DD/MM/AAAA HH:mm. Puedes añadir la duración en minutos. Todavía no se guardó ninguna cita.",
  cancelled: "De acuerdo, cancelé la solicitud. No se guardó ninguna cita.",
  conflict: "Ese horario se cruzó con otra cita y no se guardó. Envíame otra fecha y hora para preparar una nueva confirmación.",
};

export function appointmentChatReview(confirmation: AppointmentChatSummary, clientName: string, agentName: string): string {
  return `Confirma la creación de esta cita:\nCliente: ${clientName}\nAgente: ${agentName}\nFecha y hora: ${formatAppointmentLocalStart(confirmation.local_date, confirmation.local_time, Number(confirmation.start_utc_offset_minutes))}\nDuración: ${confirmation.duration_minutes} minutos\nZona horaria: ${confirmation.time_zone}\n\nResponde “Confirmar” para guardarla o “Cancelar” para descartarla.`;
}

export function appointmentChatCreated(appointment: AppointmentChatSummary, clientName: string, agentName: string): string {
  return `La cita quedó guardada en la agenda.\nCliente: ${clientName}\nAgente: ${agentName}\nFecha y hora: ${formatAppointmentLocalStart(appointment.local_date, appointment.local_time, Number(appointment.start_utc_offset_minutes))}\nDuración: ${appointment.duration_minutes} minutos\nZona horaria: ${appointment.time_zone}.`;
}

export function appointmentChatList(appointments: AppointmentChatSummary[]): string {
  return appointments.length
    ? `Estas son las citas confirmadas del cliente activo:\n${appointments.map((appointment) => `• ${formatAppointmentLocalStart(appointment.local_date, appointment.local_time, Number(appointment.start_utc_offset_minutes))} · ${appointment.duration_minutes} minutos · ${appointment.time_zone}`).join("\n")}`
    : "No hay citas confirmadas para el cliente activo.";
}
