import type { Appointment, AppointmentConfirmation, AppointmentMutationResult } from "./domain";
import { appointmentDateLabel } from "./appointment-domain";
import { dateLabel } from "./presentation";

type Props = {
  appointments: Appointment[]; loading: boolean; loadError: string; error: string; conflict: boolean; busy: boolean;
  action: "create" | "reschedule" | "cancel"; selectedId: string; date: string; time: string; duration: number;
  pending: { confirmation: AppointmentConfirmation; idempotencyKey: string } | null; result: AppointmentMutationResult | null;
  activeClientName: string; activeConversationId: string;
  onLoad: (conversationId: string) => void; onPrepare: () => void; onExecute: () => void; onInvalidate: () => void;
  onErrorChange: (value: string) => void; onConflictChange: (value: boolean) => void; onBusyChange: (value: boolean) => void;
  onActionChange: (value: "create" | "reschedule" | "cancel") => void; onSelectedIdChange: (value: string) => void;
  onDateChange: (value: string) => void; onTimeChange: (value: string) => void; onDurationChange: (value: number) => void;
};

export function AppointmentModule(props: Props) {
  const p = props;
  return <div className="module-content appointment-module">
    <header className="module-heading"><span className="eyebrow teal">AGENDA</span><h2>Gestiona tus citas</h2><p>Programa, reprograma o cancela una cita. Siempre podrás revisar los datos antes de guardar.</p></header>
    {!p.activeConversationId || !p.activeClientName ? <div className="module-empty">Primero crea o selecciona una conversación y elige un cliente en el panel izquierdo.</div> : <>
      {p.loading && <p className="search-hint">Cargando citas de este cliente…</p>}
      {p.loadError && <div className="inline-error" role="alert">{p.loadError}<button onClick={() => p.onLoad(p.activeConversationId)}>Volver a cargar citas</button></div>}
      {p.error && <div className="inline-error" role="alert">{p.error}{p.pending ? <button onClick={p.onExecute}>Reintentar con la misma clave</button> : p.conflict ? <button onClick={() => { p.onErrorChange(""); p.onConflictChange(false); document.getElementById("appointment-date")?.focus(); }}>Cambiar horario</button> : <button onClick={p.onPrepare}>Reintentar</button>}</div>}
      {!p.loading && !p.loadError && p.appointments.length === 0 && <p className="search-hint">No hay citas confirmadas de Chat PBG para este cliente.</p>}
      <div className="appointment-list">{p.appointments.map((appointment) => <div className={`appointment-row ${p.selectedId === appointment.id ? "chosen" : ""}`} key={appointment.id}>
        <div><strong>{appointmentDateLabel(appointment)}</strong><small>{appointment.local_start.slice(11, 16)} · {appointment.time_zone}</small></div>
        <div className="appointment-row-actions"><button disabled={p.busy} onClick={() => { p.onInvalidate(); p.onActionChange("reschedule"); p.onSelectedIdChange(appointment.id); p.onDateChange(appointment.local_start.slice(0, 10)); p.onTimeChange(appointment.local_start.slice(11, 16)); p.onDurationChange(Math.max(1, Math.round((new Date(appointment.end_at).getTime() - new Date(appointment.start_at).getTime()) / 60000))); }}>Reprogramar</button><button disabled={p.busy} onClick={() => { p.onInvalidate(); p.onActionChange("cancel"); p.onSelectedIdChange(appointment.id); }}>Cancelar</button></div>
      </div>)}</div>
      <div className="appointment-form-card"><div className="appointment-mode"><button disabled={p.busy} className={p.action === "create" ? "active" : ""} onClick={() => { p.onInvalidate(); p.onActionChange("create"); p.onSelectedIdChange(""); }}>Nueva cita</button></div>
        {p.action !== "cancel" && <div className="appointment-fields">
          <label>Fecha local<input id="appointment-date" type="date" value={p.date} disabled={p.busy} onChange={(event) => { p.onInvalidate(); p.onDateChange(event.target.value); }} /></label>
          <label>Hora local<input type="time" value={p.time} disabled={p.busy} onChange={(event) => { p.onInvalidate(); p.onTimeChange(event.target.value); }} /></label>
          <label>Duración<select value={p.duration} disabled={p.busy} onChange={(event) => { p.onInvalidate(); p.onDurationChange(Number(event.target.value)); }}><option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={45}>45 minutos</option><option value={60}>1 hora</option><option value={90}>1 hora 30 minutos</option><option value={120}>2 horas</option></select></label>
          <p>Zona horaria: <strong>America/Bogota</strong></p>
        </div>}
        <button className="review-appointment" onClick={p.onPrepare} disabled={p.busy || p.loading || (p.action !== "create" && !p.selectedId)}>{p.busy ? "Preparando…" : p.action === "cancel" ? "Revisar cancelación" : p.action === "reschedule" ? "Revisar reprogramación" : "Revisar cita"}</button>
      </div>
      {p.pending && <div className="appointment-review" aria-live="polite"><strong>Revisa antes de confirmar</strong><span>Acción · {p.pending.confirmation.action === "create" ? "Crear cita" : p.pending.confirmation.action === "reschedule" ? "Reprogramar cita" : "Cancelar cita"}</span><span>Cliente · {p.activeClientName}</span><span>Inicio · {p.pending.confirmation.interval.start_local}</span><span>Fin · {p.pending.confirmation.interval.end_local}</span><span>Zona · {p.pending.confirmation.interval.time_zone} (UTC{p.pending.confirmation.interval.start_utc_offset_minutes / 60})</span><small>Confirmación vence {dateLabel(p.pending.confirmation.expires_at)}. La disponibilidad se valida de nuevo al guardar.</small><div className="appointment-review-actions"><button onClick={p.onExecute} disabled={p.busy}>{p.busy ? "Guardando…" : "Confirmar operación"}</button><button disabled={p.busy} onClick={() => { p.onInvalidate(); p.onBusyChange(false); }}>Cancelar revisión</button></div></div>}
      {p.result && <div className="appointment-result" role="status"><strong>{p.result.action === "create" ? "Cita creada" : p.result.action === "reschedule" ? "Cita reprogramada" : "Cita cancelada"}{p.result.idempotent_replay ? " · resultado recuperado" : ""}</strong><span>{p.result.appointment.local_start} · {p.result.appointment.time_zone}</span></div>}
      <p className="search-hint">El conflicto de horario se valida al confirmar. Si otro guardado ocupa el intervalo, revisa un nuevo horario y confirma otra vez.</p>
    </>}
  </div>;
}
