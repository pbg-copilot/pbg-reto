import type { Message } from "../../../shared/types/domain";
import { assistantDisplayText, dateLabel, formattedText } from "../../../shared/presentation/presentation";
import { useTimelineScroll } from "../hooks/useTimelineScroll";

type Props = {
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  historyLoading: boolean;
  notice: string;
  onLoadOlder: () => void;
  visible: boolean;
  contextKey: string;
};

export function ConversationTimeline({ messages, loading, hasMore, historyLoading, notice, onLoadOlder, visible, contextKey }: Props) {
  const { feedRef, onScroll } = useTimelineScroll({ messages, loading, visible, contextKey });
  return (
    <div ref={feedRef} onScroll={onScroll} className="chat-feed" aria-live="polite">
      {loading && <div className="feed-state"><span className="loader" /> Cargando historial y contexto…</div>}
      {!loading && hasMore && <button className="load-older" onClick={onLoadOlder} disabled={historyLoading}>{historyLoading ? "Cargando…" : "Cargar mensajes anteriores"}</button>}
      {!loading && messages.length === 0 && <div className="feed-state empty-chat"><strong>Esta conversación está lista.</strong><span>Busca un cliente para fijarlo como contexto. El historial y los resultados se mantienen separados por conversación.</span></div>}
      {messages.map((message) => {
        const content = message.sender_role === "assistant" ? assistantDisplayText(message.content) : message.content;
        return (
          <article className={`message ${message.sender_role === "user" ? "user-message" : "assistant-message"}`} key={message.id}>
            <div className="message-avatar">{message.sender_role === "user" ? "Tú" : "R"}</div>
            <div className="message-content">
              <div className="message-meta">{message.sender_role === "user" ? "Tú" : "RETO"}<time>{dateLabel(message.created_at)}</time></div>
              <p>{formattedText(content)}</p>
            </div>
          </article>
        );
      })}
      {notice && <div className="saved-notice" role="status">{notice}</div>}
    </div>
  );
}
