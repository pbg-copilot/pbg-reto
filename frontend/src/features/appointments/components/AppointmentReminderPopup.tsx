import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Appointment, Client } from "../../../shared/types/domain";
import { appointmentDateLabel } from "../domain/appointment-domain";
import { isAppointmentTomorrow } from "../../follow-ups/domain/follow-up-domain";
import { WorkspaceNotificationContext } from "../../../shared/ui/workspace-notification";

type Props = {
  appointments: Appointment[];
  client: Client | null;
  clientName: string;
  onCreateFollowUp: () => void;
};

export function AppointmentReminderPopup({ appointments, client, clientName, onCreateFollowUp }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [dismissedKey, setDismissedKey] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const registerNotificationClose = useContext(WorkspaceNotificationContext);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const appointment = client
    ? appointments.filter((item) => item.client_document_path === client.document_path &&
        item.client_record_id === client.client_record_id && isAppointmentTomorrow(item, now))
      .sort((left, right) => left.start_at.localeCompare(right.start_at))[0]
    : undefined;
  const reminderKey = appointment ? `${client?.document_path}#${client?.client_record_id}:${appointment.id}` : "";
  const visible = Boolean(appointment && reminderKey !== dismissedKey);
  useLayoutEffect(() => {
    if (!visible || !closeButtonRef.current || !registerNotificationClose) return;
    return registerNotificationClose(closeButtonRef.current);
  }, [visible, registerNotificationClose]);
  if (!appointment || !visible) return null;

  return (
    <aside className="appointment-reminder-popup" role="status" aria-live="polite">
      <button ref={closeButtonRef} className="appointment-reminder-close" type="button" aria-label="Cerrar aviso" onClick={() => setDismissedKey(reminderKey)}>×</button>
      <span className="eyebrow teal">CITA MAÑANA</span>
      <strong title={clientName}>{clientName}</strong>
      <p>
        <span>{appointmentDateLabel(appointment)} a las {appointment.local_start.slice(11, 16)}</span>
        <span title={appointment.time_zone}>{appointment.time_zone}</span>
      </p>
      <button className="appointment-reminder-action" type="button" onClick={() => { setDismissedKey(reminderKey); onCreateFollowUp(); }}>Crear seguimiento</button>
    </aside>
  );
}
