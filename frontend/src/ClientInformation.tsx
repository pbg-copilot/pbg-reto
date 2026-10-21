import type { Client, ClientProfile, QuoteResponse } from "./domain";
import { dateLabel, formattedText, textValue } from "./presentation";

type Props = {
  activeClient: Client | null;
  profile: ClientProfile | null;
  quotes: QuoteResponse | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
};

export function ClientInformation({ activeClient, profile, quotes, loading, error, onRetry }: Props) {
  return <div className="client-information">
    <div className="result-heading"><span className="eyebrow teal">INFORMACIÓN DEL CLIENTE</span>{loading && <span className="mini-loader" aria-label="Cargando" />}</div>
    {error && <div className="inline-error" role="alert">{error}<button onClick={onRetry}>Reintentar</button></div>}
    {!activeClient && <div className="panel-empty">Elige un cliente para consultar su información.</div>}
    {activeClient && !profile && !quotes && !loading && !error && <div className="panel-empty">Usa “Ver expediente” o “Ver cotizaciones”.</div>}
    {profile && <div className="result-card"><div className="result-card-title"><span className="source-dot" /> Expediente encontrado</div>
      <dl className="profile-fields">{[["Nombre", profile.client.name], ["Correo", profile.client.email], ["Teléfono", profile.client.phone], ["Etapa", profile.client.stage]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ? formattedText(value) : <span className="missing-value">No consta</span>}</dd></div>)}</dl>
      <div className="missing-block"><strong>Datos faltantes</strong>{profile.missing.length ? <ul>{profile.missing.map((item) => <li key={item}>{formattedText(item)}</li>)}</ul> : <span>No se reportan campos faltantes.</span>}</div>
      <div className="notes-heading"><strong>Notas del expediente</strong><span>{profile.notes_status === "loaded" ? `${profile.notes.length} encontradas` : profile.notes_status === "empty" ? "Sin notas" : "No disponibles"}</span></div>
      {profile.notes.map((note) => <div className="note-item" key={`${note.id}-${note.index}`}><p>{formattedText(textValue(note.text))}</p><small>{dateLabel(note.occurred_at)}</small></div>)}
      {profile.activity.entries.map((entry) => <div className="note-item" key={`${entry.call_id}-${entry.note_id}`}><p>Nota de llamada</p><small>{dateLabel(entry.occurred_at)}</small></div>)}
      {profile.activity.status !== "loaded" && profile.activity.status !== "empty" && profile.activity.reason && <p className="limitation-note">Actividad {profile.activity.status === "partial" ? "parcial" : "no disponible"}: {profile.activity.reason}</p>}
    </div>}
    {quotes && <div className="result-card"><div className="result-card-title"><span className={`source-dot ${quotes.quotes_status === "empty" ? "empty-dot" : ""}`} /> Cotizaciones {quotes.quotes_status === "empty" ? "no encontradas" : "registradas"}</div>
      {quotes.quotes.length === 0 ? <p className="muted-copy">No hay coincidencias exactas para este cliente.</p> : quotes.quotes.map((quote) => <article className="quote-item" key={quote.id}><div className="quote-title"><strong>{formattedText(quote.carrier || "Aseguradora no disponible")}</strong><small>{formattedText(quote.product || "Producto no disponible")}</small></div><dl><div><dt>Valor nominal</dt><dd>{quote.face_amount_cents === null ? "No consta" : `$${(Number(quote.face_amount_cents) / 100).toLocaleString("es-CO")}`}</dd></div><div><dt>Prima mensual</dt><dd>{quote.monthly_premium_cents === null ? "No consta" : `$${(Number(quote.monthly_premium_cents) / 100).toLocaleString("es-CO")}`}</dd></div><div><dt>Prima anual</dt><dd>{quote.annual_premium_cents === null ? "No consta" : `$${(Number(quote.annual_premium_cents) / 100).toLocaleString("es-CO")}`}</dd></div></dl></article>)}
      <div className="missing-block"><strong>Faltantes y limitaciones</strong><ul>{quotes.missing.map((item) => <li key={item}>{formattedText(item)}</li>)}</ul><span>{formattedText(quotes.rules.reason)}</span></div>
    </div>}
  </div>;
}
