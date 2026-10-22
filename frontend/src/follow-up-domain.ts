import type { Appointment } from "./domain";

export function dateInTimeZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function tomorrowInTimeZone(value: Date, timeZone: string): string {
  const [year, month, day] = dateInTimeZone(value, timeZone).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function isAppointmentTomorrow(appointment: Appointment, now: Date): boolean {
  return appointment.local_start.slice(0, 10) === tomorrowInTimeZone(now, appointment.time_zone);
}

export function followUpDateLabel(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}
