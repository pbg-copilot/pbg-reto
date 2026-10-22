import type { ClientProfile } from "./domain";
import { dateLabel, formattedText, textValue } from "./presentation";

type Props = { profile: ClientProfile };

export function ClientProfileCard({ profile }: Props) {
  const fields = [
    ["Nombre", profile.client.name],
    ["Correo", profile.client.email],
    ["Teléfono", profile.client.phone],
    ["Etapa", profile.client.stage],
  ] as const;

  return (
    <div className="result-card">
      <div className="result-card-title"><span className="source-dot" /> Expediente encontrado</div>
      <dl className="profile-fields">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value ? formattedText(value) : <span className="missing-value">No consta</span>}</dd>
          </div>
        ))}
      </dl>
      <div className="missing-block">
        <strong>Datos faltantes</strong>
        {profile.missing.length
          ? <ul>{profile.missing.map((item) => <li key={item}>{formattedText(item)}</li>)}</ul>
          : <span>No se reportan campos faltantes.</span>}
      </div>
      <div className="notes-heading">
        <strong>Notas del expediente</strong>
        <span>{profile.notes_status === "loaded" ? `${profile.notes.length} encontradas` : profile.notes_status === "empty" ? "Sin notas" : "No disponibles"}</span>
      </div>
      {profile.notes.map((note) => (
        <div className="note-item" key={`${note.id}-${note.index}`}>
          <p>{formattedText(textValue(note.text))}</p>
          <small>{dateLabel(note.occurred_at)}</small>
        </div>
      ))}
      {profile.activity.entries.map((entry) => (
        <div className="note-item" key={`${entry.call_id}-${entry.note_id}`}>
          <p>Nota de llamada</p>
          <small>{dateLabel(entry.occurred_at)}</small>
        </div>
      ))}
      {profile.activity.status !== "loaded" && profile.activity.status !== "empty" && profile.activity.reason && (
        <p className="limitation-note">Actividad {profile.activity.status === "partial" ? "parcial" : "no disponible"}: {profile.activity.reason}</p>
      )}
    </div>
  );
}
