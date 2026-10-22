import type { Appointment } from "../../../shared/types/domain";
import { appointmentDateLabel } from "../domain/appointment-domain";

type Props = {
  appointments: Appointment[];
  selectedId: string;
  busy: boolean;
  onReschedule: (appointment: Appointment) => void;
  onCancel: (appointment: Appointment) => void;
};

export function AppointmentList({ appointments, selectedId, busy, onReschedule, onCancel }: Props) {
  return (
    <div className="appointment-list">
      {appointments.map((appointment) => (
        <article className={`appointment-row ${selectedId === appointment.id ? "chosen" : ""}`} key={appointment.id}>
          <div>
            <strong>{appointmentDateLabel(appointment)}</strong>
            <small>{appointment.local_start.slice(11, 16)} · {appointment.time_zone}</small>
          </div>
          <div className="appointment-row-actions">
            <button type="button" disabled={busy} onClick={() => onReschedule(appointment)}>Reprogramar</button>
            <button type="button" disabled={busy} onClick={() => onCancel(appointment)}>Cancelar</button>
          </div>
        </article>
      ))}
    </div>
  );
}
