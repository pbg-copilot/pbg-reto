import type { FormEvent } from "react";
import type { Agent, Conversation } from "../../../shared/types/domain";
import { dateLabel } from "../../../shared/presentation/presentation";

type ConversationRailProps = {
  agent: Agent;
  conversations: Conversation[];
  conversationSearch: string;
  searchLoading: boolean;
  searchError: string;
  activeConversationId: string;
  error: string;
  renamingConversationId: string;
  titleDraft: string;
  renameBusy: boolean;
  onCreate: () => void;
  onSearchChange: (query: string) => void;
  onActivate: (conversationId: string) => void;
  onBeginRename: (conversation: Conversation) => void;
  onCancelRename: () => void;
  onTitleDraftChange: (title: string) => void;
  onSaveRename: (event: FormEvent, conversationId: string) => void;
};

export function ConversationRail({
  agent,
  conversations,
  conversationSearch,
  searchLoading,
  searchError,
  activeConversationId,
  error,
  renamingConversationId,
  titleDraft,
  renameBusy,
  onCreate,
  onSearchChange,
  onActivate,
  onBeginRename,
  onCancelRename,
  onTitleDraftChange,
  onSaveRename,
}: ConversationRailProps) {
  return (
    <aside className="conversation-rail" aria-label="Conversaciones">
      <div className="rail-heading">
        <div><span className="eyebrow teal">RETO · ASISTENTE</span><h1>Conversaciones</h1></div>
        <button className="new-chat" onClick={onCreate} aria-label="Nueva conversación" title="Nueva conversación">+</button>
      </div>
      <label className="conversation-search">
        <span aria-hidden="true">⌕</span>
        <input value={conversationSearch} onChange={(event) => onSearchChange(event.target.value)} placeholder="Buscar cliente, título o mensaje" aria-label="Buscar conversaciones por cliente, título o contenido" />
      </label>
      {searchLoading && <p className="conversation-search-status" role="status">Buscando…</p>}
      {searchError && <div className="inline-error" role="alert">{searchError}</div>}
      {error && <div className="inline-error" role="alert">{error}</div>}
      {conversations.length === 0 && !error && !searchError && !searchLoading ? (
        <div className="rail-empty">{conversationSearch.trim() ? "No encontramos conversaciones que coincidan." : "Aún no tienes conversaciones. Crea una para empezar."}</div>
      ) : (
        <nav className="conversation-list">
          {conversations.map((conversation) => (
            <div key={conversation.id} className={`conversation-entry ${activeConversationId === conversation.id ? "selected" : ""}`}>
              {renamingConversationId === conversation.id ? (
                <form className="conversation-rename-form" onSubmit={(event) => onSaveRename(event, conversation.id)}>
                  <input aria-label="Nombre de la conversación" autoFocus maxLength={200} value={titleDraft} onChange={(event) => onTitleDraftChange(event.target.value)} disabled={renameBusy} />
                  <button type="submit" aria-label="Guardar nombre" title="Guardar" disabled={!titleDraft.trim() || renameBusy}>✓</button>
                  <button type="button" aria-label="Cancelar cambio de nombre" title="Cancelar" disabled={renameBusy} onClick={onCancelRename}>×</button>
                </form>
              ) : (
                <>
                  <button className="conversation-item" onClick={() => onActivate(conversation.id)}>
                    <span className="conversation-mark" />
                    <span className="conversation-copy"><strong>{conversation.title || "Conversación"}</strong><small>{conversation.active_client_record_id ? "Cliente seleccionado" : dateLabel(conversation.updated_at)}</small></span>
                  </button>
                  <button className="conversation-rename" aria-label={`Cambiar nombre: ${conversation.title || "Conversación"}`} title="Cambiar nombre" onClick={() => onBeginRename(conversation)}>✎</button>
                </>
              )}
            </div>
          ))}
        </nav>
      )}
      <div className="rail-foot"><span className="status-square" /> Sesión de {agent.name.split(" ")[0]}</div>
    </aside>
  );
}
