import { ConversationTimeline } from "../features/conversations/components/ConversationTimeline";
import { MessageComposer } from "../features/conversations/components/MessageComposer";
import type { Agent } from "../shared/types/domain";
import type { ChatWorkspaceController } from "./hooks/useChatWorkspace";

export function ConversationPanel({ workspace, agent, open }: { workspace: ChatWorkspaceController; agent: Agent; open: boolean }) {
  const { conversations: chat, clients, assistant } = workspace;
  if (!chat.activeConversationId) return (
    <div className="chat-welcome">
      <span className="welcome-icon">R</span><span className="eyebrow teal">TU ESPACIO DE TRABAJO</span>
      <h2>Hola, {agent.name.split(" ")[0]}.</h2>
      <p>Crea una conversación para consultar expedientes y cotizaciones autorizadas.</p>
    </div>
  );
  const title = chat.conversations.find((item) => item.id === chat.activeConversationId)?.title || "Conversación";
  return <>
    <header className="chat-heading">
      <div><span className="eyebrow teal">CONVERSACIÓN ACTIVA</span><h2>{title}</h2></div>
      <span className={`state-pill ${chat.conversationLoading ? "loading-state" : ""}`}>{chat.conversationLoading ? "Cargando" : "Guardada"}</span>
    </header>
    {chat.conversationError && <div className="inline-error wide" role="alert">{chat.conversationError}</div>}
    <ConversationTimeline
      messages={chat.messages} loading={chat.conversationLoading} hasMore={chat.messagesHasMore}
      historyLoading={chat.historyLoading} notice={chat.notice} onLoadOlder={() => void chat.loadOlderMessages()}
      visible={open} contextKey={`${chat.activeConversationId}:${clients.activeClient?.document_path ?? ""}#${clients.activeClient?.client_record_id ?? ""}`}
    />
    <MessageComposer
      draft={chat.messageDraft} assistantEnabled={assistant.enabled} hasActiveClient={Boolean(clients.activeClient)}
      busy={chat.messageBusy} conversationLoading={chat.conversationLoading} activeConversation
      onDraftChange={chat.setMessageDraft} onSend={() => void assistant.send()}
    />
  </>;
}
