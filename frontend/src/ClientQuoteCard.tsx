import type { QuoteResponse } from "./domain";
import { formattedText } from "./presentation";

type Quote = QuoteResponse["quotes"][number];
type Props = { quotes: QuoteResponse };

function moneyFromCents(value: string | null) {
  return value === null ? "No consta" : `$${(Number(value) / 100).toLocaleString("es-CO")}`;
}

function QuoteRow({ quote }: { quote: Quote }) {
  return (
    <article className="quote-item" key={quote.id}>
      <div className="quote-title">
        <strong>{formattedText(quote.carrier || "Aseguradora no disponible")}</strong>
        <small>{formattedText(quote.product || "Producto no disponible")}</small>
      </div>
      <dl>
        <div><dt>Valor nominal</dt><dd>{moneyFromCents(quote.face_amount_cents)}</dd></div>
        <div><dt>Prima mensual</dt><dd>{moneyFromCents(quote.monthly_premium_cents)}</dd></div>
        <div><dt>Prima anual</dt><dd>{moneyFromCents(quote.annual_premium_cents)}</dd></div>
      </dl>
    </article>
  );
}

export function ClientQuoteCard({ quotes }: Props) {
  return (
    <div className="result-card">
      <div className="result-card-title">
        <span className={`source-dot ${quotes.quotes_status === "empty" ? "empty-dot" : ""}`} />
        Cotizaciones {quotes.quotes_status === "empty" ? "no encontradas" : "registradas"}
      </div>
      {quotes.quotes.length === 0
        ? <p className="muted-copy">No hay coincidencias exactas para este cliente.</p>
        : quotes.quotes.map((quote) => <QuoteRow key={quote.id} quote={quote} />)}
      <div className="missing-block">
        <strong>Faltantes y limitaciones</strong>
        <ul>{quotes.missing.map((item) => <li key={item}>{formattedText(item)}</li>)}</ul>
        <span>{formattedText(quotes.rules.reason)}</span>
      </div>
    </div>
  );
}
