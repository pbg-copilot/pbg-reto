import type { ApiRequest } from "../shared/api/api-client";
import type { Agent } from "../shared/types/domain";
import { WorkspaceModal } from "../shared/ui/WorkspaceModal";
import { ConversationRail } from "../features/conversations/components/ConversationRail";
import { ClientContextPanel } from "../features/clients/components/ClientContextPanel";
import { FollowUpsPanel } from "../features/follow-ups/components/FollowUpsPanel";
import { AppointmentReminderPopup } from "../features/appointments/components/AppointmentReminderPopup";
import { useChatWorkspace } from "./hooks/useChatWorkspace";
import { WorkspaceCenter } from "./WorkspaceCenter";

type Props = { agent: Agent; api: ApiRequest; open: boolean; onClose: () => void };

export function ChatWorkspace({ agent, api, open, onClose }: Props) {
  const workspace = useChatWorkspace({ agent, api });
  const { conversations: chat, clients, appointments, followUps, briefing, navigation, followUpForm, actions } = workspace;
  const title = chat.conversations.find((item) => item.id === chat.activeConversationId)?.title || "Tu asistente de trabajo";
  return <WorkspaceModal
    open={open} activeModule={navigation.module} onModuleChange={navigation.changeModule}
    onClose={onClose} title={title} canManageAppointments={agent.role === "agent"}
    notification={agent.role === "agent" && clients.activeClient && !clients.detailLoading && <AppointmentReminderPopup
      appointments={appointments.appointments} client={clients.activeClient}
      clientName={clients.profile?.client.name || clients.activeClient.name} onCreateFollowUp={followUpForm.show}
    />}
  >
    <main className={`chat-shell${chat.activeConversationId ? "" : " no-active-conversation"}`}>
      <div className="conversation-sidebar">
        <ConversationRail
          agent={agent} conversations={chat.visibleConversations} conversationSearch={chat.conversationSearch}
          searchLoading={chat.conversationSearchLoading} searchError={chat.conversationSearchError}
          onSearchChange={chat.setConversationSearch} activeConversationId={chat.activeConversationId}
          error={chat.conversationError} renamingConversationId={chat.renamingConversationId}
          titleDraft={chat.conversationTitleDraft} renameBusy={chat.renamingConversationBusy}
          onCreate={actions.createConversation} onActivate={actions.activateConversation}
          onBeginRename={chat.beginRenameConversation} onCancelRename={chat.cancelRenameConversation}
          onTitleDraftChange={chat.setConversationTitleDraft} onSaveRename={(event, id) => void chat.saveConversationTitle(event, id)}
        />
        {navigation.module === "consultas" && navigation.consultation && <nav className="consultation-sidebar" aria-label="Tipos de consulta">
          <span className="eyebrow teal">CONSULTAS</span>
          <button type="button" className={navigation.consultation === "profile" ? "active" : ""} onClick={() => navigation.selectConsultation("profile")}>Expediente</button>
          <button type="button" className={navigation.consultation === "quotes" ? "active" : ""} onClick={() => navigation.selectConsultation("quotes")}>Cotizaciones</button>
        </nav>}
      </div>
      <section className="chat-main" aria-label="Chat PBG"><WorkspaceCenter workspace={workspace} agent={agent} open={open} /></section>
      {chat.activeConversationId && <ClientContextPanel
        activeClient={clients.activeClient} activeClientName={clients.profile?.client.name ?? null}
        clientQuery={clients.clientQuery} clientResults={clients.clientResults} searchLoading={clients.clientSearchLoading}
        searchError={clients.clientError} activeConversation briefingLoading={briefing.loading}
        onQueryChange={clients.setClientQuery} onSelectClient={(client) => void actions.selectClient(client)} onShowBriefing={actions.showBriefing}
      >
        {clients.activeClient && <FollowUpsPanel
          followUps={followUps.followUps} loading={followUps.loading} busy={followUps.busy} error={followUps.error}
          canManage={followUps.canManage} ready={followUps.ready} contextBusy={clients.detailLoading}
          defaultDueDate={followUps.defaultDueDate} minimumDueDate={followUps.minimumDueDate}
          openForm={followUpForm.open} onOpenForm={followUpForm.show} onCloseForm={followUpForm.close}
          onCreate={followUps.create} onComplete={followUps.complete} onRetryLoad={followUps.retryLoad}
        />}
      </ClientContextPanel>}
    </main>
  </WorkspaceModal>;
}
