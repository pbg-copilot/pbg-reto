import { AppointmentModule } from "../features/appointments/components/AppointmentModule";
import { ClientBriefingModule } from "../features/clients/components/ClientBriefingModule";
import { ConsultationModule } from "../features/clients/components/ConsultationModule";
import type { Agent } from "../shared/types/domain";
import type { ChatWorkspaceController } from "./hooks/useChatWorkspace";
import { ConversationPanel } from "./ConversationPanel";

export function WorkspaceCenter({ workspace, agent, open }: { workspace: ChatWorkspaceController; agent: Agent; open: boolean }) {
  const { navigation, briefing, actions, appointments: agenda, clients, conversations } = workspace;
  switch (navigation.module) {
    case "ficha":
      return <ClientBriefingModule briefing={briefing.briefing} loading={briefing.loading} error={briefing.error}
        onRetry={actions.showBriefing} onBackToChat={navigation.backToChat} />;
    case "agenda":
      return <AppointmentModule
        appointments={agenda.appointments} loading={agenda.appointmentsLoading} loadError={agenda.appointmentsError}
        error={agenda.appointmentError} conflict={agenda.appointmentConflict} busy={agenda.appointmentBusy}
        action={agenda.appointmentAction} selectedId={agenda.selectedAppointmentId} date={agenda.appointmentDate}
        time={agenda.appointmentTime} duration={agenda.appointmentDuration} pending={agenda.pendingAppointment} result={agenda.appointmentResult}
        activeClientName={clients.profile?.client.name || clients.activeClient?.name || ""} activeConversationId={conversations.activeConversationId}
        onLoad={(id) => void agenda.loadAppointments(id)} onPrepare={() => void agenda.prepareAppointment()}
        onExecute={() => void agenda.executeAppointment()} onInvalidate={agenda.invalidateReview}
        onErrorChange={agenda.setAppointmentError} onConflictChange={agenda.setAppointmentConflict}
        onBusyChange={agenda.setAppointmentBusy} onActionChange={agenda.setAppointmentAction}
        onSelectedIdChange={agenda.setSelectedAppointmentId} onDateChange={agenda.setAppointmentDate}
        onTimeChange={agenda.setAppointmentTime} onDurationChange={agenda.setAppointmentDuration}
      />;
    case "consultas":
      return <ConsultationModule
        selection={navigation.consultation} activeClient={clients.activeClient} profile={clients.profile} quotes={clients.quotes}
        loading={clients.detailLoading} error={clients.detailError} onSelect={navigation.selectConsultation}
        onRetry={() => {
          if (!conversations.activeConversationId) return;
          if (navigation.consultation === "quotes") void clients.loadQuotes(conversations.activeConversationId);
          else void clients.loadProfile(conversations.activeConversationId);
        }}
      />;
    default:
      return <ConversationPanel workspace={workspace} agent={agent} open={open} />;
  }
}
