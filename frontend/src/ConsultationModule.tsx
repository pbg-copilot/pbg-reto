import type { Client, ClientProfile, QuoteResponse } from "./domain";
import { ClientInformation } from "./ClientInformation";

export type ConsultationSelection = "profile" | "quotes" | null;

type Props = {
  selection: ConsultationSelection;
  activeClient: Client | null;
  profile: ClientProfile | null;
  quotes: QuoteResponse | null;
  loading: boolean;
  error: string;
  onSelect: (selection: Exclude<ConsultationSelection, null>) => void;
  onRetry: () => void;
};

export function ConsultationModule(props: Props) {
  if (!props.selection) return <section className="module-content"><header className="module-heading"><span className="eyebrow teal">CONSULTAS DETERMINISTAS</span><h2>¿Qué quieres consultar?</h2><p>Selecciona un tipo de información verificable del cliente activo.</p></header>
    <div className="query-action-grid"><button onClick={() => props.onSelect("profile")} disabled={!props.activeClient || props.loading}><span>01</span><strong>Expediente</strong><small>Perfil, notas y actividad registrada</small></button><button onClick={() => props.onSelect("quotes")} disabled={!props.activeClient || props.loading}><span>02</span><strong>Cotizaciones</strong><small>Opciones existentes y datos faltantes</small></button></div>
    {!props.activeClient && <div className="module-empty">Selecciona primero una conversación y un cliente en los paneles laterales.</div>}
  </section>;

  return <section className="module-content"><header className="module-heading"><span className="eyebrow teal">CONSULTAS DETERMINISTAS</span><h2>{props.selection === "profile" ? "Expediente del cliente" : "Cotizaciones disponibles"}</h2><p>Información del cliente seleccionado en esta conversación.</p></header>
    <ClientInformation activeClient={props.activeClient} profile={props.profile} quotes={props.quotes} loading={props.loading} error={props.error} onRetry={props.onRetry} />
  </section>;
}
