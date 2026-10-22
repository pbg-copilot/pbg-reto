import type { ReactNode } from "react";
import type { Client } from "../../../shared/types/domain";

type Props = {
  activeClient: Client | null;
  activeClientName: string | null;
  clientQuery: string;
  clientResults: Client[];
  searchLoading: boolean;
  searchError: string;
  activeConversation: boolean;
  briefingLoading: boolean;
  onQueryChange: (query: string) => void;
  onSelectClient: (client: Client) => void;
  onShowBriefing: () => void;
  children?: ReactNode;
};

export function ClientContextPanel({
  activeClient,
  activeClientName,
  clientQuery,
  clientResults,
  searchLoading,
  searchError,
  activeConversation,
  briefingLoading,
  onQueryChange,
  onSelectClient,
  onShowBriefing,
  children,
}: Props) {
  const displayName = activeClientName || activeClient?.name || "";
  return (
    <aside className="context-panel" aria-label="Cliente activo y búsqueda">
      <section className="panel-section client-context-section">
        <h2>Cliente activo</h2>
        {activeClient ? (
          <div className="active-client">
            <span className="client-avatar">
              {displayName.split(" ").slice(0, 2).map((part) => part[0]).join("")}
            </span>
            <div className="active-client-details"><strong>{displayName}</strong><small>Cliente activo</small></div>
            <button className="client-briefing-button" type="button" onClick={onShowBriefing} disabled={briefingLoading}>
              {briefingLoading ? "Preparando…" : "Su ficha"}
            </button>
          </div>
        ) : <p className="muted-copy">Selecciona un cliente para comenzar.</p>}
        <label className="search-label" htmlFor="client-search">Buscar cliente</label>
        <div className="search-box">
          <span aria-hidden="true">⌕</span>
          <input
            id="client-search"
            value={clientQuery}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Nombre o correo"
            disabled={!activeConversation}
          />
        </div>
        {searchLoading && <p className="search-hint">Buscando dentro de tu alcance…</p>}
        {searchError && <div className="inline-error" role="alert">{searchError}</div>}
        {clientQuery.trim().length > 0 && clientQuery.trim().length < 2 &&
          <p className="search-hint">Escribe al menos 2 caracteres.</p>}
        {clientResults.length > 0 && (
          <div className="client-results" role="listbox" aria-label="Resultados de clientes">
            {clientResults.map((client) => (
              <button
                key={`${client.document_path}#${client.client_record_id}`}
                type="button"
                role="option"
                aria-selected={activeClient?.client_record_id === client.client_record_id && activeClient?.document_path === client.document_path}
                onClick={() => onSelectClient(client)}
              >
                <strong>{client.name || "Sin nombre"}</strong>
                <small>{client.email || "Correo no disponible"}</small>
                <span className="result-stage">{client.stage || "Etapa no disponible"}</span>
              </button>
            ))}
          </div>
        )}
        {clientQuery.trim().length >= 2 && !searchLoading && !searchError && clientResults.length === 0 &&
          <p className="search-hint">No encontramos clientes dentro de tu alcance.</p>}
      </section>
      {children}
    </aside>
  );
}
