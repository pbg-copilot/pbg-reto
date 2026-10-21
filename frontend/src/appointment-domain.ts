import type { Appointment } from "./domain";

export function appointmentDateLabel(appointment: Appointment): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeZone: appointment.time_zone,
  }).format(new Date(appointment.start_at));
}

export function isCreateAppointmentRequest(value: string): boolean {
  return /\b(?:agendar|agenda|programar|reservar|crear)\b.{0,70}\bcita\b/i.test(value) ||
    /\b(?:quiero|necesito|puedes|podr[ií]as)\s+(?:agendar|programar|reservar|crear)\b.{0,50}\bcita\b/i.test(value);
}

export function isAppointmentListRequest(value: string): boolean {
  return /\b(?:citas?|agenda)\b/i.test(value);
}

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
