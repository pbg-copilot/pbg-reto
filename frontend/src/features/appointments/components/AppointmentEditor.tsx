type AppointmentAction = "create" | "reschedule" | "cancel";

type Props = {
  action: AppointmentAction;
  date: string;
  time: string;
  duration: number;
  busy: boolean;
  loading: boolean;
  hasSelection: boolean;
  onNew: () => void;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onDurationChange: (value: number) => void;
  onPrepare: () => void;
};

export function AppointmentEditor({ action, date, time, duration, busy, loading, hasSelection, onNew, onDateChange, onTimeChange, onDurationChange, onPrepare }: Props) {
  const buttonLabel = busy
    ? "Preparando…"
    : action === "cancel"
      ? "Revisar cancelación"
      : action === "reschedule"
        ? "Revisar reprogramación"
        : "Revisar cita";

  return (
    <div className="appointment-form-card">
      <div className="appointment-mode">
        <button type="button" disabled={busy} className={action === "create" ? "active" : ""} onClick={onNew}>Nueva cita</button>
      </div>
      {action !== "cancel" && (
        <div className="appointment-fields">
          <label>Fecha local<input id="appointment-date" type="date" value={date} disabled={busy} onChange={(event) => onDateChange(event.target.value)} /></label>
          <label>Hora local<input type="time" value={time} disabled={busy} onChange={(event) => onTimeChange(event.target.value)} /></label>
          <label>Duración
            <select value={duration} disabled={busy} onChange={(event) => onDurationChange(Number(event.target.value))}>
              <option value={15}>15 minutos</option>
              <option value={30}>30 minutos</option>
              <option value={45}>45 minutos</option>
              <option value={60}>1 hora</option>
              <option value={90}>1 hora 30 minutos</option>
              <option value={120}>2 horas</option>
            </select>
          </label>
          <p>Zona horaria: <strong>America/Bogota</strong></p>
        </div>
      )}
      <button className="review-appointment" type="button" onClick={onPrepare} disabled={busy || loading || (action !== "create" && !hasSelection)}>{buttonLabel}</button>
    </div>
  );
}
