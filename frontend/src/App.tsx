import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./styles.css";
import { Client, Message } from "./domain";
import { ApiError } from "./api-client";
import { appointmentDateLabel } from "./appointment-domain";
import { textValue } from "./presentation";
import { Arrow, Chevron, LogoutIcon } from "./ui";
import { LoginPage } from "./LoginPage";
import { ConversationRail } from "./ConversationRail";
import { useSession } from "./hooks/useSession";
import { useAppointmentWorkflow } from "./hooks/useAppointmentWorkflow";
import { useClientContext } from "./hooks/useClientContext";
import { WorkspaceModal, type WorkspaceModule } from "./WorkspaceModal";
import { AppointmentModule } from "./AppointmentModule";
import { ConsultationModule, type ConsultationSelection } from "./ConsultationModule";
import { ClientContextPanel } from "./ClientContextPanel";
import { ConversationTimeline } from "./ConversationTimeline";
import { MessageComposer } from "./MessageComposer";
import { createConversationWorkspaceEffects, useConversationWorkspace } from "./hooks/useConversationWorkspace";
import { ClientBriefingModule } from "./ClientBriefingModule";
import { loadClientBriefing, type ClientBriefing } from "./client-briefing-service";
import { useFollowUps } from "./hooks/useFollowUps";
import { FollowUpsPanel } from "./FollowUpsPanel";
import { AppointmentReminderPopup } from "./AppointmentReminderPopup";

function App() {
  const [menu, setMenu] = useState(false),
    [chatOpen, setChatOpen] = useState(false),
    [workspaceModule, setWorkspaceModule] = useState<WorkspaceModule>("chat");
  const [consultationSelection, setConsultationSelection] = useState<ConsultationSelection>(null);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [clientBriefing, setClientBriefing] = useState<ClientBriefing | null>(null);
  const [clientBriefingLoading, setClientBriefingLoading] = useState(false);
  const [clientBriefingError, setClientBriefingError] = useState("");
  const [followUpFormOpen, setFollowUpFormOpen] = useState(false);
  const conversationEffects = useRef(createConversationWorkspaceEffects());
  const menuRef = useRef<HTMLDivElement>(null),
    buttonRef = useRef<HTMLButtonElement>(null);
  function clearWorkspace() {
    setChatOpen(false); setWorkspaceModule("chat");
    setConsultationSelection(null);
    setClientBriefing(null); setClientBriefingLoading(false); setClientBriefingError(""); setFollowUpFormOpen(false);
    conversationWorkspace.reset();
  }
  const { agent, loading, error, busy, api, login: authenticate, logout: endSession } = useSession(clearWorkspace);
  const conversationWorkspace = useConversationWorkspace({ api, agentId: agent?.id, effectsRef: conversationEffects });
  const {
    conversations, visibleConversations, setConversations, activeConversationId, renamingConversationId,
    conversationSearch, setConversationSearch, conversationSearchLoading, conversationSearchError,
    refreshConversationSearch,
    conversationTitleDraft, renamingConversationBusy, setConversationTitleDraft,
    messages, setMessages, messagesHasMore, setMessagesHasMore, messagesCursor,
    setMessagesCursor, historyLoading, conversationLoading, conversationError,
    setConversationError, messageDraft, setMessageDraft, messageBusy, setMessageBusy,
    notice, setNotice, contextRequest, activeConversationRef,
    saveConversationTitle, beginRenameConversation, cancelRenameConversation,
    reloadConversationHistory, loadOlderMessages,
    activateConversation: activateConversationWorkspace,
    createConversation: createConversationWorkspace,
  } = conversationWorkspace;
  useEffect(() => {
    if (!chatOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setChatOpen(false); };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", closeOnEscape); };
  }, [chatOpen]);
  useEffect(() => {
    document.title = agent ? "RETO · Chat" : "RETO · Iniciar sesión";
  }, [agent]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenu(false);
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !chatOpen) { setMenu(false); buttonRef.current?.focus(); }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [chatOpen]);
  useEffect(() => {
    if (!agent) { setAssistantEnabled(false); return; }
    let current = true;
    void api<{ enabled: boolean }>("/api/assistant/status").then((status) => {
      if (current) setAssistantEnabled(status.enabled);
    }).catch(() => { if (current) setAssistantEnabled(false); });
    return () => { current = false; };
  }, [agent?.id]);
  const clientContext = useClientContext({
    api,
    agentId: agent?.id,
    activeConversationId,
    contextRequest,
    activeConversationRef,
    setConversations,
    setMessages,
    setMessagesHasMore,
    setMessagesCursor,
    setMessageDraft,
  });
  const {
    clientQuery, setClientQuery, clientResults, clientSearchLoading, clientError,
    activeClient, setActiveClient, profile, quotes,
    detailLoading, detailError,
    reset: resetClientContext, loadProfile, loadQuotes, selectClient: selectClientContext,
  } = clientContext;
  const appointmentWorkflow = useAppointmentWorkflow({
    api,
    agent,
    activeConversationId,
    activeClient,
    contextRequest,
    activeConversationRef,
    setMessages,
    setMessageDraft,
    setMessageBusy,
    setConversationError,
    setNotice,
    setConversations,
  });
  const {
    appointments, appointmentsLoading, appointmentsError,
    appointmentError, setAppointmentError, appointmentConflict, setAppointmentConflict,
    appointmentBusy, setAppointmentBusy, appointmentAction, setAppointmentAction,
    selectedAppointmentId, setSelectedAppointmentId, appointmentDate, setAppointmentDate,
    appointmentTime, setAppointmentTime, appointmentDuration, setAppointmentDuration,
    pendingAppointment, appointmentResult, reset: resetAppointmentWorkflow,
    loadAppointments, restoreChatState: restoreAppointmentChatState,
    handleChat: handleAppointmentChat, invalidateReview: invalidateAppointmentReview,
    prepareAppointment, executeAppointment,
  } = appointmentWorkflow;
  const followUpWorkflow = useFollowUps({ api, conversationId: activeConversationId, client: activeClient, role: agent?.role });
  useLayoutEffect(() => {
    conversationEffects.current = {
      resetClientContext,
      resetAppointmentWorkflow,
      setActiveClient,
      loadProfile,
      loadAppointments,
      restoreAppointmentChatState,
    };
  });
  function selectClient(client: Client) {
    setConsultationSelection(null);
    setClientBriefing(null); setClientBriefingLoading(false); setClientBriefingError(""); setFollowUpFormOpen(false);
    setWorkspaceModule("chat");
    setFollowUpFormOpen(false);
    const selection = selectClientContext(client, {
      resetAppointments: resetAppointmentWorkflow,
      reloadHistory: reloadConversationHistory,
      loadAppointments,
    });
    void selection.finally(() => refreshConversationSearch());
    return selection;
  }
  useEffect(() => {
    if (conversationSearch.trim()) refreshConversationSearch();
  }, [messages.length, activeConversationId, conversationSearch, activeClient?.document_path, activeClient?.client_record_id, refreshConversationSearch]);
  function changeWorkspaceModule(module: WorkspaceModule) {
    if (module === "consultas") setConsultationSelection(null);
    if (module !== "ficha") setClientBriefingError("");
    setWorkspaceModule(module);
  }
  async function showClientBriefing() {
    if (!activeConversationId || !activeClient || clientBriefingLoading) return;
    const conversationId = activeConversationId;
    const requestId = contextRequest.current;
    setWorkspaceModule("ficha");
    setConsultationSelection(null);
    setClientBriefing(null);
    setClientBriefingError("");
    setClientBriefingLoading(true);
    try {
      const briefing = await loadClientBriefing(api, conversationId);
      if (requestId !== contextRequest.current || conversationId !== activeConversationRef.current) return;
      setClientBriefing(briefing);
    } catch (cause) {
      if (requestId === contextRequest.current && conversationId === activeConversationRef.current)
        setClientBriefingError(cause instanceof Error ? cause.message : "No se pudo preparar la ficha del cliente.");
    } finally {
      if (requestId === contextRequest.current) setClientBriefingLoading(false);
    }
  }
  function selectConsultation(selection: Exclude<ConsultationSelection, null>) {
    setConsultationSelection(selection);
    if (!activeConversationId) return;
    if (selection === "profile") void loadProfile(activeConversationId);
    else void loadQuotes(activeConversationId);
  }
  function activateConversation(conversationId: string) {
    setClientBriefing(null); setClientBriefingLoading(false); setClientBriefingError(""); setFollowUpFormOpen(false);
    setWorkspaceModule("chat"); setConsultationSelection(null);
    activateConversationWorkspace(conversationId);
  }
  function createConversation() {
    setClientBriefing(null); setClientBriefingLoading(false); setClientBriefingError(""); setFollowUpFormOpen(false);
    setWorkspaceModule("chat"); setConsultationSelection(null);
    void createConversationWorkspace();
  }
  async function askAssistant() {
    const content = messageDraft.trim();
    if (!content || !activeConversationId || !activeClient || messageBusy) return;
    if (await handleAppointmentChat(content)) return;
    if (!assistantEnabled) {
      setConversationError("El asistente está deshabilitado. Configura el proveedor para enviar preguntas normales; puedes iniciar una cita escribiendo “Agendar cita”.");
      return;
    }
    const conversationId = activeConversationId;
    setMessageBusy(true); setConversationError(""); setNotice("");
    try {
      const result = await api<{ messages: Message[] }>(`/api/conversations/${conversationId}/assistant`, { method: "POST", body: JSON.stringify({ content }) });
      if (conversationId === activeConversationRef.current) {
        setMessages((current) => [...current, ...result.messages]); setMessageDraft(""); setNotice("Respuesta redactada con evidencia autorizada y guardada en el historial.");
        const updatedAt = result.messages[result.messages.length - 1]?.created_at;
        if (updatedAt) setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, updated_at: updatedAt } : item));
      }
    } catch (e) {
      if (conversationId === activeConversationRef.current && !(e instanceof ApiError && e.status === 401)) setConversationError(e instanceof Error ? e.message : "No se pudo redactar una respuesta.");
    } finally { setMessageBusy(false); }
  }
  async function login({ username, password }: { username: string; password: string }) {
    if (await authenticate({ username, password })) setMenu(false);
  }
  async function logout() {
    if (await endSession()) setMenu(false);
  }
  if (loading)
    return (
      <div className="loading" role="status">
        <span className="wordmark">RETO</span>
        <div className="loader" />
        Preparando tu espacio
      </div>
    );
  if (agent)
    return (
      <div className="workspace">
        <header className="topbar">
          <a className="wordmark" href="/" aria-label="RETO, inicio">
            RETO
            <span className="brand-dot" />
          </a>
          <div className="account" ref={menuRef}>
            <div className="agent-label">
              <span className="eyebrow">AGENTE</span>
              <span data-testid="agent-name">{agent.name}</span>
            </div>
            <button
              ref={buttonRef}
              className="account-toggle"
              aria-label="Menú de cuenta"
              aria-expanded={menu}
              aria-haspopup="menu"
              onClick={() => setMenu(!menu)}
            >
              <span className="avatar">
                {agent.name
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <Chevron />
            </button>
            {menu && (
              <div className="account-menu" role="menu">
                <button
                  role="menuitem"
                  onClick={() => void logout()}
                  disabled={busy}
                >
                  <LogoutIcon />
                  {busy ? "Cerrando sesión…" : "Logout"}
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="home-screen">
          <section className="home-welcome-card"><span className="home-icon">P</span><span className="eyebrow teal">TU ESPACIO DE TRABAJO</span><h1>Hola, {agent.name.split(" ")[0]}.</h1><p>Abre Chat PBG para conversar, revisar información de clientes y gestionar citas desde un solo lugar.</p><button type="button" onClick={() => setChatOpen(true)}>Abrir Chat PBG <Arrow /></button></section>
          <section className="home-feature-grid" aria-label="Funciones de Chat PBG"><article><span>01</span><strong>Conversaciones</strong><p>Retoma el historial de cada cliente con su propio contexto.</p></article><article><span>02</span><strong>Consultas deterministas</strong><p>Revisa perfiles y cotizaciones que constan en los registros.</p></article><article><span>03</span><strong>Agenda</strong><p>Programa citas y revisa cada cambio antes de confirmarlo.</p></article></section>
        </main>
        <button className="chat-launcher" type="button" onClick={() => setChatOpen(true)}><span className="launcher-icon">P</span><span>Chat PBG</span></button>
        <WorkspaceModal open={chatOpen} activeModule={workspaceModule} onModuleChange={changeWorkspaceModule} onClose={() => setChatOpen(false)} title={conversations.find((item) => item.id === activeConversationId)?.title || "Tu asistente de trabajo"} canManageAppointments={agent.role === "agent"}
          notification={agent.role === "agent" && activeClient && !detailLoading && <AppointmentReminderPopup
            appointments={appointments}
            client={activeClient}
            clientName={profile?.client.name || activeClient.name}
            onCreateFollowUp={() => setFollowUpFormOpen(true)}
          />}
        >
        <main className={`chat-shell${activeConversationId ? "" : " no-active-conversation"}`}>
          <div className="conversation-sidebar">
          <ConversationRail
            agent={agent}
            conversations={visibleConversations}
            conversationSearch={conversationSearch}
            searchLoading={conversationSearchLoading}
            searchError={conversationSearchError}
            onSearchChange={setConversationSearch}
            activeConversationId={activeConversationId}
            error={conversationError}
            renamingConversationId={renamingConversationId}
            titleDraft={conversationTitleDraft}
            renameBusy={renamingConversationBusy}
            onCreate={createConversation}
            onActivate={activateConversation}
            onBeginRename={beginRenameConversation}
            onCancelRename={cancelRenameConversation}
            onTitleDraftChange={setConversationTitleDraft}
            onSaveRename={(event, id) => void saveConversationTitle(event, id)}
          />
          {workspaceModule === "consultas" && consultationSelection && <nav className="consultation-sidebar" aria-label="Tipos de consulta"><span className="eyebrow teal">CONSULTAS</span><button type="button" className={consultationSelection === "profile" ? "active" : ""} onClick={() => selectConsultation("profile")}>Expediente</button><button type="button" className={consultationSelection === "quotes" ? "active" : ""} onClick={() => selectConsultation("quotes")}>Cotizaciones</button></nav>}
          </div>
          <section className="chat-main" aria-label="Chat PBG">
            {workspaceModule === "ficha" ? <ClientBriefingModule briefing={clientBriefing} loading={clientBriefingLoading} error={clientBriefingError} onRetry={() => void showClientBriefing()} onBackToChat={() => setWorkspaceModule("chat")} /> : workspaceModule === "agenda" ? <AppointmentModule appointments={appointments} loading={appointmentsLoading} loadError={appointmentsError} error={appointmentError} conflict={appointmentConflict} busy={appointmentBusy} action={appointmentAction} selectedId={selectedAppointmentId} date={appointmentDate} time={appointmentTime} duration={appointmentDuration} pending={pendingAppointment} result={appointmentResult} activeClientName={profile?.client.name || activeClient?.name || ""} activeConversationId={activeConversationId} onLoad={(id) => void loadAppointments(id)} onPrepare={() => void prepareAppointment()} onExecute={() => void executeAppointment()} onInvalidate={invalidateAppointmentReview} onErrorChange={setAppointmentError} onConflictChange={setAppointmentConflict} onBusyChange={setAppointmentBusy} onActionChange={setAppointmentAction} onSelectedIdChange={setSelectedAppointmentId} onDateChange={setAppointmentDate} onTimeChange={setAppointmentTime} onDurationChange={setAppointmentDuration} /> : workspaceModule === "consultas" ? <ConsultationModule selection={consultationSelection} activeClient={activeClient} profile={profile} quotes={quotes} loading={detailLoading} error={detailError} onSelect={selectConsultation} onRetry={() => { if (!activeConversationId) return; if (consultationSelection === "quotes") void loadQuotes(activeConversationId); else void loadProfile(activeConversationId); }} /> : <>
            {!activeConversationId ? <div className="chat-welcome"><span className="welcome-icon">R</span><span className="eyebrow teal">TU ESPACIO DE TRABAJO</span><h2>Hola, {agent.name.split(" ")[0]}.</h2><p>Crea una conversación para consultar expedientes y cotizaciones autorizadas.</p></div> : <>
              <header className="chat-heading"><div><span className="eyebrow teal">CONVERSACIÓN ACTIVA</span><h2>{conversations.find((item) => item.id === activeConversationId)?.title || "Conversación"}</h2></div><span className={`state-pill ${conversationLoading ? "loading-state" : ""}`}>{conversationLoading ? "Cargando" : "Guardada"}</span></header>
              {conversationError && <div className="inline-error wide" role="alert">{conversationError}</div>}
              <ConversationTimeline messages={messages} loading={conversationLoading} hasMore={messagesHasMore} historyLoading={historyLoading} notice={notice} onLoadOlder={() => void loadOlderMessages()} visible={chatOpen} contextKey={`${activeConversationId}:${activeClient?.document_path ?? ""}#${activeClient?.client_record_id ?? ""}`} />
              <MessageComposer draft={messageDraft} assistantEnabled={assistantEnabled} hasActiveClient={Boolean(activeClient)} busy={messageBusy} conversationLoading={conversationLoading} activeConversation={Boolean(activeConversationId)} onDraftChange={setMessageDraft} onSend={() => void askAssistant()} />
            </>}
            </>}
          </section>
          {activeConversationId && <ClientContextPanel activeClient={activeClient} activeClientName={profile?.client.name ?? null} clientQuery={clientQuery} clientResults={clientResults} searchLoading={clientSearchLoading} searchError={clientError} activeConversation={Boolean(activeConversationId)} briefingLoading={clientBriefingLoading} onQueryChange={setClientQuery} onSelectClient={(client) => void selectClient(client)} onShowBriefing={() => void showClientBriefing()}>
            {activeClient && <FollowUpsPanel
              followUps={followUpWorkflow.followUps}
              loading={followUpWorkflow.loading}
              busy={followUpWorkflow.busy}
              error={followUpWorkflow.error}
              canManage={followUpWorkflow.canManage}
              ready={followUpWorkflow.ready}
              contextBusy={detailLoading}
              defaultDueDate={followUpWorkflow.defaultDueDate}
              minimumDueDate={followUpWorkflow.minimumDueDate}
              openForm={followUpFormOpen}
              onOpenForm={() => setFollowUpFormOpen(true)}
              onCloseForm={() => setFollowUpFormOpen(false)}
              onCreate={followUpWorkflow.create}
              onComplete={followUpWorkflow.complete}
              onRetryLoad={followUpWorkflow.retryLoad}
            />}
          </ClientContextPanel>}
        </main>
        </WorkspaceModal>
      </div>
    );
  return <LoginPage busy={busy} error={error} onSubmit={login} />;
}
export default App;
