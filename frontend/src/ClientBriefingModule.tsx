import type { Appointment } from "./domain";
import type { ClientBriefing } from "./client-briefing-service";
import { appointmentDateLabel } from "./appointment-domain";
import { dateLabel, formattedText, textValue } from "./presentation";

type Props = {
  briefing: ClientBriefing | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onBackToChat: () => void;
};

function moneyFromCents(value: string | null) {
  return value === null ? "No consta" : `$${(Number(value) / 100).toLocaleString("es-CO")}`;
}

function appointmentDescription(appointment: Appointment) {
  const duration = Math.round(
    (new Date(appointment.end_at).getTime() - new Date(appointment.start_at).getTime()) / 60000,
  );
  return `${appointmentDateLabel(appointment)} a las ${appointment.local_start.slice(11, 16)} · ${duration} minutos · ${appointment.time_zone}`;
}

export function ClientBriefingModule({ briefing, loading, error, onRetry, onBackToChat }: Props) {
  const now = Date.now();
  const upcomingAppointments = briefing?.appointments
    .filter((appointment) => new Date(appointment.start_at).getTime() >= now)
    .sort((left, right) => left.start_at.localeCompare(right.start_at)) ?? [];
  const recentNotes = briefing?.profile.notes.slice(-3).reverse() ?? [];
  const missingItems = [
    ...(briefing?.profile.missing ?? []),
    ...(briefing?.quotes.missing ?? []),
  ];

  return (
    <section className="module-content client-briefing" aria-live="polite">
      <header className="module-heading">
        <button className="briefing-back-button" type="button" aria-label="Volver al chat" title="Volver al chat" onClick={onBackToChat}>
          ←
        </button>
        <span className="eyebrow teal">FICHA DEL CLIENTE</span>
        <h2>Resumen para preparar la conversación</h2>
        <p>Resumen generado con la información registrada en el perfil, las cotizaciones y la agenda.</p>
      </header>
      {loading && <p className="briefing-state" role="status">Reuniendo la información del expediente…</p>}
      {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={onRetry}>Volver a intentar</button></div>}
      {!loading && !error && briefing && <>
        <section className="briefing-card">
          <h3>Cliente</h3>
          <dl className="briefing-facts">
            <div><dt>Nombre</dt><dd>{briefing.profile.client.name || "No consta"}</dd></div>
            <div><dt>Etapa</dt><dd>{briefing.profile.client.stage || "No consta"}</dd></div>
            <div><dt>Correo</dt><dd>{briefing.profile.client.email || "No consta"}</dd></div>
            <div><dt>Teléfono</dt><dd>{briefing.profile.client.phone || "No consta"}</dd></div>
          </dl>
        </section>

        <section className="briefing-card">
          <h3>Últimas notas</h3>
          {recentNotes.length ? <ul className="briefing-list">
            {recentNotes.map((note) => <li key={`${note.id}-${note.index}`}>
              <span>{formattedText(textValue(note.text))}</span>
              <small>{dateLabel(note.occurred_at)}</small>
            </li>)}
          </ul> : <p>No hay notas disponibles en el expediente.</p>}
          <p className="briefing-meta">Actividad con fecha verificable: {briefing.profile.activity.entries.length}{briefing.profile.activity.status === "partial" ? " (registro parcial)" : ""}.</p>
        </section>

        <section className="briefing-card">
          <h3>Cotizaciones registradas</h3>
          {briefing.quotes.quotes.length ? <ul className="briefing-list">
            {briefing.quotes.quotes.map((quote) => <li key={quote.id}>
              <span><strong>{quote.carrier || "Aseguradora no disponible"}</strong> · {quote.product || "Producto no disponible"}<br />Prima mensual: {moneyFromCents(quote.monthly_premium_cents)} · Prima anual: {moneyFromCents(quote.annual_premium_cents)}</span>
              <small>Registro: {dateLabel(quote.recorded_at)}</small>
            </li>)}
          </ul> : <p>No hay cotizaciones con coincidencia exacta para este cliente.</p>}
          <p className="briefing-meta">Los importes son valores almacenados; no confirman vigencia, aprobación ni emisión.</p>
        </section>

        <section className="briefing-card">
          <h3>Próxima cita</h3>
          {upcomingAppointments[0]
            ? <p>{appointmentDescription(upcomingAppointments[0])}</p>
            : <p>No hay citas futuras confirmadas en la agenda.</p>}
        </section>

        <section className="briefing-card briefing-follow-up">
          <h3>Datos por confirmar</h3>
          {missingItems.length
            ? <ul>{[...new Set(missingItems)].map((item) => <li key={item}>{formattedText(item)}</li>)}</ul>
            : <p>No se reportan faltantes en las consultas realizadas.</p>}
          <p>El resumen no recomienda productos ni completa datos ausentes.</p>
        </section>
      </>}
    </section>
  );
}
