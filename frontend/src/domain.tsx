export type Agent = {
  id: string;
  name: string;
  username: string;
  email: string;
  agency_name: string | null;
  role: string;
};
export type Conversation = {
  id: string;
  title: string | null;
  status: "active" | "archived";
  active_client_path: string | null;
  active_client_record_id: string | null;
  updated_at: string;
};
export type Message = {
  id: string;
  sequence_no: string;
  sender_role: "user" | "assistant" | "tool";
  content: string;
  created_at: string;
};
export type Client = {
  document_path: string;
  client_record_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string | null;
};
export type ClientProfile = {
  client: { id: string; name: string | null; email: string | null; phone: string | null; stage: string | null };
  source: { type: string; document_path: string; client_record_id: string; date: string | null };
  missing: string[];
  notes_status: "loaded" | "empty" | "unavailable";
  notes: Array<{ id: string; index: string; text: { original?: string | null; es?: string | null; en?: string | null }; occurred_at: string | null; source: { document_path: string; client_record_id: string; note_id: string; note_index: string; date: string | null } }>;
  activity: { status: "loaded" | "partial" | "empty" | "unavailable"; entries: Array<{ call_id: string; note_id: string; occurred_at: string; source: { document_path: string; client_record_id: string; note_id: string; note_index: string; date: string | null } }>; reason?: string | null };
};
export type QuoteResponse = {
  quotes_status: "loaded" | "empty";
  quotes: Array<{ id: string; carrier: string | null; product: string | null; face_amount_cents: string | null; monthly_premium_cents: string | null; annual_premium_cents: string | null; recorded_at: string | null; source: { type: string; table: string; record_id: string; client_record_id: string; date: string | null; match_basis: string } }>;
  rules: { status: string; reason: string };
  missing: string[];
};
export type Appointment = {
  id: string;
  conversation_id: string;
  client_document_path: string;
  client_record_id: string;
  agent_account_id: string;
  start_at: string;
  end_at: string;
  time_zone: string;
  local_start: string;
  start_utc_offset_minutes: number;
  status: "confirmed" | "cancelled";
};
export type AppointmentAction = "create" | "reschedule" | "cancel";
export type AppointmentConfirmation = {
  id: string;
  expires_at: string;
  action: AppointmentAction;
  appointment_id: string | null;
  client_document_path: string;
  client_record_id: string;
  agent_account_id: string;
  interval: {
    start_at: string;
    end_at: string;
    duration_minutes: number;
    time_zone: string;
    start_local: string;
    end_local: string;
    start_utc_offset_minutes: number;
  };
};
export type AppointmentMutationResult = {
  action: AppointmentAction;
  appointment: Appointment;
  idempotent_replay?: boolean;
};
export type AppointmentChatKind = "request_details" | "invalid_details" | "review" | "repeat_confirmation" | "created" | "conflict" | "cancelled" | "appointments_list";
export type AppointmentChatStage = "idle" | "details" | "confirmation";
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
export const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "Fecha no disponible";
export const appointmentDateLabel = (appointment: Appointment) => new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: appointment.time_zone }).format(new Date(appointment.start_at));
export const isCreateAppointmentRequest = (value: string) => /\b(?:agendar|agenda|programar|reservar|crear)\b.{0,70}\bcita\b/i.test(value) || /\b(?:quiero|necesito|puedes|podr[ií]as)\s+(?:agendar|programar|reservar|crear)\b.{0,50}\bcita\b/i.test(value);
export const isAppointmentListRequest = (value: string) => /\b(?:lista|listar|liste|muestra|mostrar|mu[eé]strame|ver|consulta|consultar|dime|indica)\b.{0,60}\b(?:citas?|agenda)\b/i.test(value) || /\b(?:citas?|agenda)\b.{0,50}\b(?:tengo|hay|existe|agendada|programada|confirmada|confirmadas)\b/i.test(value) || /\b(?:tengo|hay|existe)\b.{0,40}\b(?:citas?|agenda)\b/i.test(value);
export function parseAppointmentDetails(value: string) {
  const match = value.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})[ T](\d{1,2}:\d{2})(?:\s*(a\.?m\.?|p\.?m\.?))?/i);
  if (!match) return null;
  const [, rawDate, rawTime, meridiem] = match;
  let date = rawDate;
  if (rawDate.includes("/")) {
    const [day, month, year] = rawDate.split("/").map(Number);
    date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const [year, month, day] = date.split("-").map(Number);
  const calendarDate = new Date(0);
  calendarDate.setUTCHours(0, 0, 0, 0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null;
  let [hour, minute] = rawTime.split(":").map(Number);
  if (minute > 59 || hour > 23 || hour < 0) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (meridiem.toLowerCase().startsWith("p")) hour += 12;
  }
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const durationMatch = value.match(/\b(\d{1,4})\s*(?:minutos?|mins?)\b/i);
  const durationMinutes = durationMatch ? Number(durationMatch[1]) : 30;
  if (durationMinutes < 1 || durationMinutes > 1440) return null;
  const zoneMatch = value.match(/\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)?/);
  return { localStart: `${date}T${time}`, durationMinutes, timeZone: zoneMatch?.[0] || "America/Bogota" };
}
export const textValue = (value: { original?: string | null; es?: string | null; en?: string | null }) => value.original ?? value.es ?? value.en ?? "Texto no disponible";
export function formattedText(value: string) {
  return value.split(/(\*\*[\s\S]+?\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part.replace(/\*\*/g, ""),
  );
}
export function assistantDisplayText(value: string) {
  return value
    .replace(/(?:^|\n)[ \t]*(?:[-*][ \t]+)?(?:\*\*)?(?:fuentes?|sources?)(?:[ \t]+consultadas?)?(?:\*\*)?[ \t]*:[^\r\n]*/gi, "")
    .replace(/\s+(?:fuentes?|sources?)(?:[ \t]+consultadas?)?[ \t]*:[^\r\n]*$/i, "")
    .replace(/\bleads-store\/books\/[^\s`),;]+/gi, "")
    .replace(/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/gi, "")
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, "\n\n")
    .trim();
}
