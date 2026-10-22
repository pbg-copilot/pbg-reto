import { useEffect, useState, type FormEvent } from "react";
import type { FollowUp } from "../../../shared/types/domain";
import { followUpDateLabel } from "../domain/follow-up-domain";

type Props = {
  followUps: FollowUp[];
  loading: boolean;
  busy: boolean;
  error: string;
  canManage: boolean;
  ready: boolean;
  contextBusy: boolean;
  defaultDueDate: string;
  minimumDueDate: string;
  openForm: boolean;
  onOpenForm: () => void;
  onCloseForm: () => void;
  onCreate: (description: string, dueDate: string) => Promise<boolean>;
  onComplete: (id: string) => Promise<boolean>;
  onRetryLoad: () => void;
};

export function FollowUpsPanel(props: Props) {
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(props.defaultDueDate);

  useEffect(() => {
    if (!props.openForm) {
      setDescription("");
      return;
    }
    setDescription("");
    setDueDate(props.defaultDueDate);
  }, [props.openForm, props.defaultDueDate]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!description.trim() || !dueDate) return;
    if (await props.onCreate(description.trim(), dueDate)) {
      setDescription("");
      setDueDate(props.defaultDueDate);
      props.onCloseForm();
    }
  }

  return (
    <section className="panel-section follow-ups-section" aria-labelledby="follow-ups-title">
      <div className="follow-ups-heading">
        <h2 id="follow-ups-title">Seguimientos pendientes</h2>
        {props.canManage && <button type="button" disabled={props.contextBusy} onClick={() => { setDueDate(props.defaultDueDate); props.onOpenForm(); }}>Nuevo</button>}
      </div>
      {props.loading && <p className="search-hint">Cargando seguimientos…</p>}
      {props.error && <div className="inline-error" role="alert">{props.error}{!props.ready && <button type="button" disabled={props.loading || props.busy} onClick={props.onRetryLoad}>Reintentar carga</button>}</div>}
      {props.openForm && props.canManage && <form className="follow-up-form" onSubmit={(event) => void submit(event)}>
        <label>Seguimiento<input maxLength={500} required value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ej. Llamar para confirmar documentos" disabled={props.busy || props.contextBusy} /></label>
        <label>Fecha<input type="date" min={props.minimumDueDate} required value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={props.busy || props.contextBusy} /></label>
        <div><button type="submit" disabled={props.busy || props.contextBusy || !props.ready || !description.trim()}>{props.busy ? "Guardando…" : "Guardar seguimiento"}</button><button type="button" disabled={props.busy || props.contextBusy} onClick={props.onCloseForm}>Cancelar</button></div>
      </form>}
      {props.ready && !props.followUps.length && !props.openForm && <p className="search-hint">No hay seguimientos pendientes para este cliente.</p>}
      <ul className="follow-up-list">
        {props.followUps.map((followUp) => <li key={followUp.id}>
          <div><strong>{followUp.description}</strong><small>{followUpDateLabel(followUp.due_date)}</small></div>
          {props.canManage && <button type="button" disabled={props.busy || props.contextBusy || !props.ready} onClick={() => void props.onComplete(followUp.id)}>Completar</button>}
        </li>)}
      </ul>
    </section>
  );
}
