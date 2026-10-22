import type { AppointmentConfirmation, AppointmentMutationResult } from "./domain";
import { dateLabel } from "./presentation";

type Pending = { confirmation: AppointmentConfirmation; idempotencyKey: string } | null;

type Props = {
  pending: Pending;
  result: AppointmentMutationResult | null;
  activeClientName: string;
  busy: boolean;
  onExecute: () => void;
  onCancelReview: () => void;
};

export function AppointmentReview({ pending, result, activeClientName, busy, onExecute, onCancelReview }: Props) {
  return <>
    {pending && <div className="appointment-review" aria-live="polite">
      <strong>Revisa antes de confirmar</strong>
      <span>Acción · {pending.confirmation.action === "create" ? "Crear cita" : pending.confirmation.action === "reschedule" ? "Reprogramar cita" : "Cancelar cita"}</span>
      <span>Cliente · {activeClientName}</span>
      <span>Inicio · {pending.confirmation.interval.start_local}</span>
      <span>Fin · {pending.confirmation.interval.end_local}</span>
      <span>Zona · {pending.confirmation.interval.time_zone} (UTC{pending.confirmation.interval.start_utc_offset_minutes / 60})</span>
      <small>Confirmación vence {dateLabel(pending.confirmation.expires_at)}. La disponibilidad se valida de nuevo al guardar.</small>
      <div className="appointment-review-actions">
        <button type="button" onClick={onExecute} disabled={busy}>{busy ? "Guardando…" : "Confirmar operación"}</button>
        <button type="button" disabled={busy} onClick={onCancelReview}>Cancelar revisión</button>
      </div>
    </div>}
    {result && <div className="appointment-result" role="status">
      <strong>{result.action === "create" ? "Cita creada" : result.action === "reschedule" ? "Cita reprogramada" : "Cita cancelada"}{result.idempotent_replay ? " · resultado recuperado" : ""}</strong>
      <span>{result.appointment.local_start} · {result.appointment.time_zone}</span>
    </div>}
  </>;
}
