import React, { useEffect, useRef, useState } from "react";
import "./styles.css";
import { Agent, Client, Conversation, Message } from "./domain";
import { ApiError, apiRequest } from "./api-client";
import { appointmentDateLabel } from "./appointment-domain";
import { textValue } from "./presentation";
import { Arrow, Chevron, LogoutIcon } from "./ui";
import { LoginPage } from "./LoginPage";
import { ConversationRail } from "./ConversationRail";
import { AuthenticationError, getCurrentAgent, signIn, signOut } from "./auth-service";
import { useAppointmentWorkflow } from "./hooks/useAppointmentWorkflow";
import { useClientContext } from "./hooks/useClientContext";
import { WorkspaceModal, type WorkspaceModule } from "./WorkspaceModal";
import { AppointmentModule } from "./AppointmentModule";
import { ConsultationModule, type ConsultationSelection } from "./ConsultationModule";
import { ClientContextPanel } from "./ClientContextPanel";
import { ConversationTimeline } from "./ConversationTimeline";
import { MessageComposer } from "./MessageComposer";

function App() {
  const [agent, setAgent] = useState<Agent | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [chatOpen, setChatOpen] = useState(false),
    [workspaceModule, setWorkspaceModule] = useState<WorkspaceModule>("chat");
  const [consultationSelection, setConsultationSelection] = useState<ConsultationSelection>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [renamingConversationId, setRenamingConversationId] = useState("");
  const [conversationTitleDraft, setConversationTitleDraft] = useState("");
  const [renamingConversationBusy, setRenamingConversationBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [messageBusy, setMessageBusy] = useState(false);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [notice, setNotice] = useState("");
  const contextRequest = useRef(0);
  const activeConversationRef = useRef("");
  const menuRef = useRef<HTMLDivElement>(null),
    buttonRef = useRef<HTMLButtonElement>(null);
  function clearWorkspace() {
    contextRequest.current += 1;
    setChatOpen(false); setWorkspaceModule("chat");
    setConsultationSelection(null);
    activeConversationRef.current = "";
    setConversations([]); setActiveConversationId(""); setRenamingConversationId(""); setConversationTitleDraft(""); setMessages([]);
    setMessagesHasMore(false); setMessagesCursor(null);
    setMessageDraft("");
    resetAppointmentWorkflow();
    resetClientContext();
    setConversationError(""); setNotice("");
    setConversationLoading(false); setHistoryLoading(false); setMessageBusy(false);
  }
  async function restore() {
    try {
      const restored = await getCurrentAgent();
      if (restored) {
        if (agent && agent.id !== restored.id) clearWorkspace();
        setAgent(restored);
        setError("");
      } else {
        setAgent(null);
        clearWorkspace();
      }
    } catch {
      setError("No pudimos conectar. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void restore();
  }, []);
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
    if (!agent) return;
    const check = () => {
      if (document.visibilityState === "visible") void restore();
    };
    const interval = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", check);
    };
  }, [agent?.id]);
  useEffect(() => {
    if (!agent) { setAssistantEnabled(false); return; }
    let current = true;
    void api<{ enabled: boolean }>("/api/assistant/status").then((status) => {
      if (current) setAssistantEnabled(status.enabled);
    }).catch(() => { if (current) setAssistantEnabled(false); });
    return () => { current = false; };
  }, [agent?.id]);
  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    return apiRequest<T>(path, init, () => {
      setAgent(null);
      clearWorkspace();
      setError("Tu sesión venció. Inicia sesión para continuar.");
    });
  }
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
  async function saveConversationTitle(event: React.FormEvent, conversationId: string) {
    event.preventDefault();
    const title = conversationTitleDraft.trim();
    if (!title || !conversationId || renamingConversationBusy) return;
    setRenamingConversationBusy(true);
    setConversationError("");
    try {
      const result = await api<{ conversation: Conversation }>(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
      });
      setConversations((current) => [result.conversation, ...current.filter((item) => item.id !== conversationId)]);
      setRenamingConversationId("");
      setConversationTitleDraft("");
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) setConversationError(e instanceof Error ? e.message : "No se pudo cambiar el nombre.");
    } finally {
      setRenamingConversationBusy(false);
    }
  }
  async function createConversation() {
    try {
      const result = await api<{ conversation: Conversation }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "Nueva conversación" }),
      });
      setConversations((current) => [result.conversation, ...current]);
      activateConversation(result.conversation.id);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        setConversationError(e instanceof Error ? e.message : "No se pudo crear la conversación.");
    }
  }
  function beginRenameConversation(conversation: Conversation) {
    setRenamingConversationId(conversation.id);
    setConversationTitleDraft(conversation.title || "");
    setConversationError("");
  }
  function cancelRenameConversation() {
    setRenamingConversationId("");
    setConversationTitleDraft("");
  }
  async function reloadConversationHistory(conversationId: string, requestId: number) {
    const history = await api<{ conversation: Conversation; messages: Message[]; pagination: { hasMore: boolean; nextBeforeSequence: string | null } }>(`/api/conversations/${conversationId}?limit=100`);
    if (requestId !== contextRequest.current || conversationId !== activeConversationRef.current) return;
    setMessages(history.messages);
    setMessagesHasMore(history.pagination.hasMore);
    setMessagesCursor(history.pagination.nextBeforeSequence);
  }
  function selectClient(client: Client) {
    setConsultationSelection(null);
    return selectClientContext(client, {
      resetAppointments: resetAppointmentWorkflow,
      reloadHistory: reloadConversationHistory,
      loadAppointments,
    });
  }
  function changeWorkspaceModule(module: WorkspaceModule) {
    if (module === "consultas") setConsultationSelection(null);
    setWorkspaceModule(module);
  }
  function selectConsultation(selection: Exclude<ConsultationSelection, null>) {
    setConsultationSelection(selection);
    if (!activeConversationId) return;
    if (selection === "profile") void loadProfile(activeConversationId);
    else void loadQuotes(activeConversationId);
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
  useEffect(() => {
    if (!agent) return;
    let cancelled = false;
    setConversationError("");
    api<{ conversations: Conversation[] }>("/api/conversations").then((result) => {
      if (cancelled) return;
      setConversations(result.conversations);
      const current = activeConversationRef.current;
      const next = current && result.conversations.some((item) => item.id === current) ? current : result.conversations[0]?.id ?? "";
      activeConversationRef.current = next;
      setActiveConversationId(next);
    }).catch((error) => { if (!cancelled && !(error instanceof ApiError && error.status === 401)) setConversationError(error instanceof Error ? error.message : "No se pudieron cargar las conversaciones."); });
    return () => { cancelled = true; };
  }, [agent?.id]);
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]); setMessagesHasMore(false); setMessagesCursor(null); resetClientContext(); return;
    }
    const requestId = ++contextRequest.current;
    let cancelled = false;
    setConversationLoading(true); setConversationError("");
    setMessages([]); setMessagesHasMore(false); setMessagesCursor(null); resetClientContext();
    resetAppointmentWorkflow();
    setMessageDraft(""); setNotice("");
    api<{ conversation: Conversation; messages: Message[]; pagination: { hasMore: boolean; nextBeforeSequence: string | null } }>(`/api/conversations/${activeConversationId}?limit=100`).then(async (history) => {
      if (cancelled || requestId !== contextRequest.current) return;
      setMessages(history.messages);
      setMessagesHasMore(history.pagination.hasMore);
      setMessagesCursor(history.pagination.nextBeforeSequence);
      const conversation = history.conversation;
      setConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, ...conversation } : item));
      if (conversation.active_client_path && conversation.active_client_record_id) {
        setActiveClient({ document_path: conversation.active_client_path, client_record_id: conversation.active_client_record_id, name: "Cliente seleccionado", email: null, phone: null, stage: null });
        await Promise.all([
          loadProfile(conversation.id, requestId),
          loadAppointments(conversation.id, requestId),
          restoreAppointmentChatState(conversation.id, requestId),
        ]);
      }
    }).catch((error) => {
      if (!cancelled && requestId === contextRequest.current && !(error instanceof ApiError && error.status === 401)) setConversationError(error instanceof Error ? error.message : "No se pudo abrir la conversación.");
    }).finally(() => { if (!cancelled && requestId === contextRequest.current) setConversationLoading(false); });
    return () => { cancelled = true; };
  }, [activeConversationId, agent?.id]);
  async function loadOlderMessages() {
    if (!activeConversationId || !messagesCursor || historyLoading) return;
    const conversationId = activeConversationId;
    const requestId = contextRequest.current;
    setHistoryLoading(true);
    try {
      const result = await api<{ messages: Message[]; pagination: { hasMore: boolean; nextBeforeSequence: string | null } }>(`/api/conversations/${conversationId}?limit=100&beforeSequence=${encodeURIComponent(messagesCursor)}`);
      if (requestId !== contextRequest.current || conversationId !== activeConversationId) return;
      setMessages((current) => [...result.messages, ...current]);
      setMessagesHasMore(result.pagination.hasMore);
      setMessagesCursor(result.pagination.nextBeforeSequence);
    } catch (e) {
      if (requestId === contextRequest.current && conversationId === activeConversationRef.current && !(e instanceof ApiError && e.status === 401)) setConversationError(e instanceof Error ? e.message : "No se pudo cargar el historial anterior.");
    } finally { if (requestId === contextRequest.current && conversationId === activeConversationRef.current) setHistoryLoading(false); }
  }
  function activateConversation(conversationId: string) {
    setRenamingConversationId(""); setConversationTitleDraft("");
    contextRequest.current += 1;
    resetAppointmentWorkflow();
    activeConversationRef.current = conversationId;
    setActiveConversationId(conversationId);
    setMessages([]); setMessagesHasMore(false); setMessagesCursor(null);
    setHistoryLoading(false);
    resetClientContext();
    setConsultationSelection(null);
    setMessageDraft(""); setNotice(""); setConversationError("");
  }
  async function login({ username, password }: { username: string; password: string }) {
    setBusy(true);
    setError("");
    try {
      setAgent(await signIn(username, password));
      clearWorkspace();
      setMenu(false);
    } catch (error) {
      setError(error instanceof AuthenticationError ? error.message : "No pudimos conectar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await signOut();
      setAgent(null);
      clearWorkspace();
      setMenu(false);
    } catch {
      setError("No fue posible cerrar sesión. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
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
        <WorkspaceModal open={chatOpen} activeModule={workspaceModule} onModuleChange={changeWorkspaceModule} onClose={() => setChatOpen(false)} title={conversations.find((item) => item.id === activeConversationId)?.title || "Tu asistente de trabajo"} canManageAppointments={agent.role === "agent"}>
        <main className={`chat-shell${activeConversationId ? "" : " no-active-conversation"}`}>
          <div className="conversation-sidebar">
          <ConversationRail
            agent={agent}
            conversations={conversations}
            activeConversationId={activeConversationId}
            error={conversationError}
            renamingConversationId={renamingConversationId}
            titleDraft={conversationTitleDraft}
            renameBusy={renamingConversationBusy}
            onCreate={() => void createConversation()}
            onActivate={activateConversation}
            onBeginRename={beginRenameConversation}
            onCancelRename={cancelRenameConversation}
            onTitleDraftChange={setConversationTitleDraft}
            onSaveRename={(event, id) => void saveConversationTitle(event, id)}
          />
          {workspaceModule === "consultas" && consultationSelection && <nav className="consultation-sidebar" aria-label="Tipos de consulta"><span className="eyebrow teal">CONSULTAS</span><button type="button" className={consultationSelection === "profile" ? "active" : ""} onClick={() => selectConsultation("profile")}>Expediente</button><button type="button" className={consultationSelection === "quotes" ? "active" : ""} onClick={() => selectConsultation("quotes")}>Cotizaciones</button></nav>}
          </div>
          <section className="chat-main" aria-label="Chat PBG">
            {workspaceModule === "agenda" ? <AppointmentModule appointments={appointments} loading={appointmentsLoading} loadError={appointmentsError} error={appointmentError} conflict={appointmentConflict} busy={appointmentBusy} action={appointmentAction} selectedId={selectedAppointmentId} date={appointmentDate} time={appointmentTime} duration={appointmentDuration} pending={pendingAppointment} result={appointmentResult} activeClientName={profile?.client.name || activeClient?.name || ""} activeConversationId={activeConversationId} onLoad={(id) => void loadAppointments(id)} onPrepare={() => void prepareAppointment()} onExecute={() => void executeAppointment()} onInvalidate={invalidateAppointmentReview} onErrorChange={setAppointmentError} onConflictChange={setAppointmentConflict} onBusyChange={setAppointmentBusy} onActionChange={setAppointmentAction} onSelectedIdChange={setSelectedAppointmentId} onDateChange={setAppointmentDate} onTimeChange={setAppointmentTime} onDurationChange={setAppointmentDuration} /> : workspaceModule === "consultas" ? <ConsultationModule selection={consultationSelection} activeClient={activeClient} profile={profile} quotes={quotes} loading={detailLoading} error={detailError} onSelect={selectConsultation} onRetry={() => { if (!activeConversationId) return; if (consultationSelection === "quotes") void loadQuotes(activeConversationId); else void loadProfile(activeConversationId); }} /> : <>
            {!activeConversationId ? <div className="chat-welcome"><span className="welcome-icon">R</span><span className="eyebrow teal">TU ESPACIO DE TRABAJO</span><h2>Hola, {agent.name.split(" ")[0]}.</h2><p>Crea una conversación para consultar expedientes y cotizaciones autorizadas.</p></div> : <>
              <header className="chat-heading"><div><span className="eyebrow teal">CONVERSACIÓN ACTIVA</span><h2>{conversations.find((item) => item.id === activeConversationId)?.title || "Conversación"}</h2></div><span className={`state-pill ${conversationLoading ? "loading-state" : ""}`}>{conversationLoading ? "Cargando" : "Guardada"}</span></header>
              {conversationError && <div className="inline-error wide" role="alert">{conversationError}</div>}
              <ConversationTimeline messages={messages} loading={conversationLoading} hasMore={messagesHasMore} historyLoading={historyLoading} notice={notice} onLoadOlder={() => void loadOlderMessages()} />
              <MessageComposer draft={messageDraft} assistantEnabled={assistantEnabled} hasActiveClient={Boolean(activeClient)} busy={messageBusy} conversationLoading={conversationLoading} activeConversation={Boolean(activeConversationId)} onDraftChange={setMessageDraft} onSend={() => void askAssistant()} />
            </>}
            </>}
          </section>
          {activeConversationId && <ClientContextPanel activeClient={activeClient} activeClientName={profile?.client.name ?? null} clientQuery={clientQuery} clientResults={clientResults} searchLoading={clientSearchLoading} searchError={clientError} activeConversation={Boolean(activeConversationId)} onQueryChange={setClientQuery} onSelectClient={(client) => void selectClient(client)} />}
        </main>
        </WorkspaceModal>
      </div>
    );
  return <LoginPage busy={busy} error={error} onSubmit={login} />;
}
export default App;
