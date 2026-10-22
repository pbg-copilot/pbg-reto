import type { Appointment, AppointmentConfirmation, AppointmentMutationResult } from "../../../shared/types/domain";
import { AppointmentEditor } from "./AppointmentEditor";
import { AppointmentList } from "./AppointmentList";
import { AppointmentReview } from "./AppointmentReview";

type Props = {
  appointments: Appointment[];
  loading: boolean;
  loadError: string;
  error: string;
  conflict: boolean;
  busy: boolean;
  action: "create" | "reschedule" | "cancel";
  selectedId: string;
  date: string;
  time: string;
  duration: number;
  pending: { confirmation: AppointmentConfirmation; idempotencyKey: string } | null;
  result: AppointmentMutationResult | null;
  activeClientName: string;
  activeConversationId: string;
  onLoad: (conversationId: string) => void;
  onPrepare: () => void;
  onExecute: () => void;
  onInvalidate: () => void;
  onErrorChange: (value: string) => void;
  onConflictChange: (value: boolean) => void;
  onBusyChange: (value: boolean) => void;
  onActionChange: (value: "create" | "reschedule" | "cancel") => void;
  onSelectedIdChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onDurationChange: (value: number) => void;
};

export function AppointmentModule(props: Props) {
  const canManageClientAppointments = Boolean(props.activeConversationId && props.activeClientName);

  function reschedule(appointment: Appointment) {
    props.onInvalidate();
    props.onActionChange("reschedule");
    props.onSelectedIdChange(appointment.id);
    props.onDateChange(appointment.local_start.slice(0, 10));
    props.onTimeChange(appointment.local_start.slice(11, 16));
    props.onDurationChange(Math.max(1, Math.round((new Date(appointment.end_at).getTime() - new Date(appointment.start_at).getTime()) / 60000)));
  }

  function cancel(appointment: Appointment) {
    props.onInvalidate();
    props.onActionChange("cancel");
    props.onSelectedIdChange(appointment.id);
  }

  function startNewAppointment() {
    props.onInvalidate();
    props.onActionChange("create");
    props.onSelectedIdChange("");
  }

  return (
    <div className="module-content appointment-module">
      <header className="module-heading">
        <span className="eyebrow teal">AGENDA</span>
        <h2>Gestiona tus citas</h2>
        <p>Programa, reprograma o cancela una cita. Siempre podrás revisar los datos antes de guardar.</p>
      </header>
      {!canManageClientAppointments ? (
        <div className="module-empty">Primero crea o selecciona una conversación y elige un cliente en el panel izquierdo.</div>
      ) : (
        <>
          {props.loading && <p className="search-hint">Cargando citas de este cliente…</p>}
          {props.loadError && <div className="inline-error" role="alert">{props.loadError}<button type="button" onClick={() => props.onLoad(props.activeConversationId)}>Volver a cargar citas</button></div>}
          {props.error && <div className="inline-error" role="alert">
            {props.error}
            {props.pending ? (
              <button type="button" onClick={props.onExecute}>Reintentar con la misma clave</button>
            ) : props.conflict ? (
              <button type="button" onClick={() => { props.onErrorChange(""); props.onConflictChange(false); document.getElementById("appointment-date")?.focus(); }}>Cambiar horario</button>
            ) : <button type="button" onClick={props.onPrepare}>Reintentar</button>}
          </div>}
          {!props.loading && !props.loadError && props.appointments.length === 0 &&
            <p className="search-hint">No hay citas confirmadas de Chat PBG para este cliente.</p>}
          <AppointmentList
            appointments={props.appointments}
            selectedId={props.selectedId}
            busy={props.busy}
            onReschedule={reschedule}
            onCancel={cancel}
          />
          <AppointmentEditor
            action={props.action}
            date={props.date}
            time={props.time}
            duration={props.duration}
            busy={props.busy}
            loading={props.loading}
            hasSelection={Boolean(props.selectedId)}
            onNew={startNewAppointment}
            onDateChange={(value) => { props.onInvalidate(); props.onDateChange(value); }}
            onTimeChange={(value) => { props.onInvalidate(); props.onTimeChange(value); }}
            onDurationChange={(value) => { props.onInvalidate(); props.onDurationChange(value); }}
            onPrepare={props.onPrepare}
          />
          <AppointmentReview
            pending={props.pending}
            result={props.result}
            activeClientName={props.activeClientName}
            busy={props.busy}
            onExecute={props.onExecute}
            onCancelReview={() => { props.onInvalidate(); props.onBusyChange(false); }}
          />
          <p className="search-hint">El conflicto de horario se valida al confirmar. Si otro guardado ocupa el intervalo, revisa un nuevo horario y confirma otra vez.</p>
        </>
      )}
    </div>
  );
}
