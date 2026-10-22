import type { Client, ClientProfile, QuoteResponse } from "./domain";
import { ClientProfileCard } from "./ClientProfileCard";
import { ClientQuoteCard } from "./ClientQuoteCard";

type Props = {
  activeClient: Client | null;
  profile: ClientProfile | null;
  quotes: QuoteResponse | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
};

export function ClientInformation({ activeClient, profile, quotes, loading, error, onRetry }: Props) {
  return (
    <div className="client-information">
      <div className="result-heading">
        <span className="eyebrow teal">INFORMACIÓN DEL CLIENTE</span>
        {loading && <span className="mini-loader" aria-label="Cargando" />}
      </div>
      {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={onRetry}>Reintentar</button></div>}
      {!activeClient && <div className="panel-empty">Elige un cliente para consultar su información.</div>}
      {activeClient && !profile && !quotes && !loading && !error && (
        <div className="panel-empty">Usa “Ver expediente” o “Ver cotizaciones”.</div>
      )}
      {profile && <ClientProfileCard profile={profile} />}
      {quotes && <ClientQuoteCard quotes={quotes} />}
    </div>
  );
}
