import React, { useEffect, useRef, useState } from "react";
import "./styles.css";
import { Agent, Client, Conversation, Message } from "./domain";
import { ApiError, apiRequest } from "./api-client";
import { appointmentDateLabel } from "./appointment-domain";
import { assistantDisplayText, dateLabel, formattedText, textValue } from "./presentation";
import { Arrow, Chevron, LogoutIcon } from "./ui";
import { LoginPage } from "./LoginPage";
import { ConversationRail } from "./ConversationRail";
import { AuthenticationError, getCurrentAgent, signIn, signOut } from "./auth-service";
import { useAppointmentWorkflow } from "./hooks/useAppointmentWorkflow";
import { useClientContext } from "./hooks/useClientContext";

function App() {
  const [agent, setAgent] = useState<Agent | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false);
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
    document.title = agent ? "RETO · Chat" : "RETO · Iniciar sesión";
  }, [agent]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenu(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);
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
    return selectClientContext(client, {
      resetAppointments: resetAppointmentWorkflow,
      reloadHistory: reloadConversationHistory,
      loadAppointments,
    });
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
        <main className="chat-shell">
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
          <section className="chat-main" aria-label="Chat y contexto">
            {!activeConversationId ? <div className="chat-welcome"><span className="welcome-icon">R</span><span className="eyebrow teal">TU ESPACIO DE TRABAJO</span><h2>Hola, {agent.name.split(" ")[0]}.</h2><p>Crea una conversación para consultar expedientes y cotizaciones autorizadas.</p></div> : <>
              <header className="chat-heading"><div><span className="eyebrow teal">CONVERSACIÓN ACTIVA</span><h2>{conversations.find((item) => item.id === activeConversationId)?.title || "Conversación"}</h2></div><span className={`state-pill ${conversationLoading ? "loading-state" : ""}`}>{conversationLoading ? "Cargando" : "Guardada"}</span></header>
              {conversationError && <div className="inline-error wide" role="alert">{conversationError}</div>}
              <div className="chat-feed" aria-live="polite">
                {conversationLoading && <div className="feed-state"><span className="loader" /> Cargando historial y contexto…</div>}
                {!conversationLoading && messagesHasMore && <button className="load-older" onClick={() => void loadOlderMessages()} disabled={historyLoading}>{historyLoading ? "Cargando…" : "Cargar mensajes anteriores"}</button>}
                {!conversationLoading && messages.length === 0 && <div className="feed-state empty-chat"><strong>Esta conversación está lista.</strong><span>Busca un cliente para fijarlo como contexto. El historial y los resultados se mantienen separados por conversación.</span></div>}
                {messages.map((message) => { const content = message.sender_role === "assistant" ? assistantDisplayText(message.content) : message.content; return <article className={`message ${message.sender_role === "user" ? "user-message" : "assistant-message"}`} key={message.id}><div className="message-avatar">{message.sender_role === "user" ? "Tú" : "R"}</div><div className="message-content"><div className="message-meta">{message.sender_role === "user" ? "Tú" : "RETO"}<time>{dateLabel(message.created_at)}</time></div><p>{formattedText(content)}</p></div></article>; })}
                {notice && <div className="saved-notice" role="status">{notice}</div>}
              </div>
              <form className="composer" onSubmit={(event) => { event.preventDefault(); void askAssistant(); }}><label htmlFor="message-draft" className="sr-only">Escribe una pregunta o solicitud de cita</label><textarea id="message-draft" value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void askAssistant(); } }} placeholder="Pregunta algo o escribe “Agendar cita”…" maxLength={4000} rows={2} disabled={conversationLoading || !activeConversationId} /><div className="composer-bottom"><span>{assistantEnabled ? "Puedes consultar al asistente o escribir “Agendar cita”." : "IA deshabilitada; puedes escribir “Agendar cita”."} Enter para enviar · Shift+Enter para nueva línea.</span><button className="composer-submit" type="submit" disabled={!messageDraft.trim() || !activeClient || messageBusy || conversationLoading}>{messageBusy ? "Procesando…" : "Enviar"}<Arrow /></button></div></form>
            </>}
          </section>
          <aside className="context-panel" aria-label="Cliente y consultas">
            <div className="panel-section"><span className="eyebrow teal">CONTEXTO DEL EXPEDIENTE</span><h2>Cliente activo</h2>
              {activeClient ? <div className="active-client"><span className="client-avatar">{(profile?.client.name || activeClient.name).split(" ").slice(0,2).map((part) => part[0]).join("")}</span><div><strong>{profile?.client.name || activeClient.name}</strong><small>Cliente activo</small></div></div> : <p className="muted-copy">Selecciona un cliente para consultar su perfil y sus cotizaciones.</p>}
              <label className="search-label" htmlFor="client-search">Buscar cliente</label><div className="search-box"><span aria-hidden="true">⌕</span><input id="client-search" value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Nombre o correo" disabled={!activeConversationId} /></div>
              {clientSearchLoading && <p className="search-hint">Buscando dentro de tu alcance…</p>}{clientError && <div className="inline-error" role="alert">{clientError}</div>}{clientQuery.trim().length > 0 && clientQuery.trim().length < 2 && <p className="search-hint">Escribe al menos 2 caracteres.</p>}{clientResults.length > 0 && <div className="client-results" role="listbox" aria-label="Resultados de clientes">{clientResults.map((client) => <button key={`${client.document_path}#${client.client_record_id}`} role="option" aria-selected={activeClient?.client_record_id === client.client_record_id && activeClient?.document_path === client.document_path} onClick={() => void selectClient(client)}><strong>{client.name || "Sin nombre"}</strong><small>{client.email || "Correo no disponible"}</small><span className="result-stage">{client.stage || "Etapa no disponible"}</span></button>)}</div>}{clientQuery.trim().length >= 2 && !clientSearchLoading && !clientError && clientResults.length === 0 && <p className="search-hint">No encontramos clientes dentro de tu alcance.</p>}
            </div>
              {activeClient && <div className="panel-section lookup-actions"><span className="eyebrow teal">CONSULTAS DETERMINISTAS</span><div className="action-buttons"><button onClick={() => activeConversationId && void loadProfile(activeConversationId)} disabled={detailLoading || !activeConversationId}>Ver expediente</button><button onClick={() => activeConversationId && void loadQuotes(activeConversationId)} disabled={detailLoading || !activeConversationId}>Ver cotizaciones</button></div><p className="search-hint">Solo se muestran los datos autorizados y la información faltante.</p></div>}
            {activeClient && agent?.role === "agent" && <div className="panel-section appointment-section">
              <span className="eyebrow teal">AGENDA</span><h3>Gestionar cita</h3>
              {appointmentsLoading && <p className="search-hint">Cargando citas de este cliente…</p>}
              {appointmentsError && <div className="inline-error" role="alert">{appointmentsError}<button onClick={() => activeConversationId && void loadAppointments(activeConversationId)}>Volver a cargar citas</button></div>}
              {appointmentError && <div className="inline-error" role="alert">{appointmentError}{pendingAppointment ? <button onClick={() => void executeAppointment()}>Reintentar con la misma clave</button> : appointmentConflict ? <button onClick={() => { setAppointmentError(""); setAppointmentConflict(false); document.getElementById("appointment-date")?.focus(); }}>Cambiar horario para reintentar</button> : <button onClick={() => void prepareAppointment()}>Reintentar</button>}</div>}
              {!appointmentsLoading && !appointmentsError && appointments.length === 0 && <p className="search-hint">No hay citas confirmadas de Chat PBG para este cliente.</p>}
              {appointments.map((appointment) => <div className={`appointment-row ${selectedAppointmentId === appointment.id ? "chosen" : ""}`} key={appointment.id}>
                <div><strong>{appointmentDateLabel(appointment)}</strong><small>{appointment.local_start.slice(11, 16)} · {appointment.time_zone}</small></div>
                <div className="appointment-row-actions"><button disabled={appointmentBusy} onClick={() => { invalidateAppointmentReview(); setAppointmentAction("reschedule"); setSelectedAppointmentId(appointment.id); setAppointmentDate(appointment.local_start.slice(0, 10)); setAppointmentTime(appointment.local_start.slice(11, 16)); setAppointmentDuration(Math.max(1, Math.round((new Date(appointment.end_at).getTime() - new Date(appointment.start_at).getTime()) / 60000))); }}>Reprogramar</button><button disabled={appointmentBusy} onClick={() => { invalidateAppointmentReview(); setAppointmentAction("cancel"); setSelectedAppointmentId(appointment.id); }}>Cancelar cita</button></div>
              </div>)}
              <div className="appointment-mode"><button disabled={appointmentBusy} className={appointmentAction === "create" ? "active" : ""} onClick={() => { invalidateAppointmentReview(); setAppointmentAction("create"); setSelectedAppointmentId(""); }}>Nueva cita</button></div>
              {appointmentAction !== "cancel" && <div className="appointment-fields">
                <label>Fecha local<input id="appointment-date" type="date" value={appointmentDate} disabled={appointmentBusy} onChange={(event) => { invalidateAppointmentReview(); setAppointmentDate(event.target.value); }} /></label>
                <label>Hora local<input type="time" value={appointmentTime} disabled={appointmentBusy} onChange={(event) => { invalidateAppointmentReview(); setAppointmentTime(event.target.value); }} /></label>
                <label>Duración<select value={appointmentDuration} disabled={appointmentBusy} onChange={(event) => { invalidateAppointmentReview(); setAppointmentDuration(Number(event.target.value)); }}><option value={15}>15 minutos</option><option value={30}>30 minutos</option><option value={45}>45 minutos</option><option value={60}>1 hora</option><option value={90}>1 hora 30 minutos</option><option value={120}>2 horas</option></select></label>
                <p>Zona horaria: <strong>America/Bogota</strong></p>
              </div>}
              <button className="review-appointment" onClick={() => void prepareAppointment()} disabled={appointmentBusy || appointmentsLoading || !activeConversationId || (appointmentAction !== "create" && !selectedAppointmentId)}>{appointmentBusy ? "Preparando…" : appointmentAction === "cancel" ? "Revisar cancelación" : appointmentAction === "reschedule" ? "Revisar reprogramación" : "Revisar cita"}</button>
              {pendingAppointment && <div className="appointment-review" aria-live="polite"><strong>Revisa antes de confirmar</strong><span>Acción · {pendingAppointment.confirmation.action === "create" ? "Crear cita" : pendingAppointment.confirmation.action === "reschedule" ? "Reprogramar cita" : "Cancelar cita"}</span><span>Cliente · {activeClient.name}</span><span>Inicio · {pendingAppointment.confirmation.interval.start_local}</span><span>Fin · {pendingAppointment.confirmation.interval.end_local}</span><span>Zona · {pendingAppointment.confirmation.interval.time_zone} (UTC{pendingAppointment.confirmation.interval.start_utc_offset_minutes / 60})</span><small>Confirmación vence {dateLabel(pendingAppointment.confirmation.expires_at)}. La disponibilidad se valida de nuevo al guardar.</small><div className="appointment-review-actions"><button onClick={() => void executeAppointment()} disabled={appointmentBusy}>{appointmentBusy ? "Guardando…" : "Confirmar operación"}</button><button disabled={appointmentBusy} onClick={() => { invalidateAppointmentReview(); setAppointmentBusy(false); }}>Cancelar revisión</button></div></div>}
              {appointmentResult && <div className="appointment-result" role="status"><strong>{appointmentResult.action === "create" ? "Cita creada" : appointmentResult.action === "reschedule" ? "Cita reprogramada" : "Cita cancelada"}{appointmentResult.idempotent_replay ? " · resultado recuperado" : ""}</strong><span>{appointmentResult.appointment.local_start} · {appointmentResult.appointment.time_zone}</span></div>}
              <p className="search-hint">El conflicto de horario se valida al confirmar. Si otro guardado ocupa el intervalo, revisa un nuevo horario y confirma otra vez.</p>
            </div>}
            <div className="panel-section results-section"><div className="result-heading"><span className="eyebrow teal">INFORMACIÓN DEL CLIENTE</span>{detailLoading && <span className="mini-loader" aria-label="Cargando" />}</div>{detailError && <div className="inline-error" role="alert">{detailError}<button onClick={() => activeConversationId && activeClient && void loadProfile(activeConversationId)}>Reintentar</button></div>}{!activeClient && <div className="panel-empty">Elige un cliente para consultar su información.</div>}{activeClient && !profile && !quotes && !detailLoading && !detailError && <div className="panel-empty">Usa “Ver expediente” o “Ver cotizaciones”.</div>}
              {profile && <div className="result-card"><div className="result-card-title"><span className="source-dot" /> Expediente encontrado</div><dl className="profile-fields">{[["Nombre", profile.client.name], ["Correo", profile.client.email], ["Teléfono", profile.client.phone], ["Etapa", profile.client.stage]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ? formattedText(value) : <span className="missing-value">No consta</span>}</dd></div>)}</dl><div className="missing-block"><strong>Datos faltantes</strong>{profile.missing.length ? <ul>{profile.missing.map((item) => <li key={item}>{formattedText(item)}</li>)}</ul> : <span>No se reportan campos faltantes.</span>}</div><div className="notes-heading"><strong>Notas del expediente</strong><span>{profile.notes_status === "loaded" ? `${profile.notes.length} encontradas` : profile.notes_status === "empty" ? "Sin notas" : "No disponibles"}</span></div>{profile.notes.map((note) => <div className="note-item" key={`${note.id}-${note.index}`}><p>{formattedText(textValue(note.text))}</p><small>{dateLabel(note.occurred_at)}</small></div>)}{profile.activity.entries.map((entry) => <div className="note-item" key={`${entry.call_id}-${entry.note_id}`}><p>Nota de llamada</p><small>{dateLabel(entry.occurred_at)}</small></div>)}{profile.activity.status !== "loaded" && profile.activity.status !== "empty" && profile.activity.reason && <p className="limitation-note">Actividad {profile.activity.status === "partial" ? "parcial" : "no disponible"}: {profile.activity.reason}</p>}</div>}
              {quotes && <div className="result-card"><div className="result-card-title"><span className={`source-dot ${quotes.quotes_status === "empty" ? "empty-dot" : ""}`} /> Cotizaciones {quotes.quotes_status === "empty" ? "no encontradas" : "registradas"}</div>{quotes.quotes.length === 0 ? <p className="muted-copy">No hay coincidencias exactas para este cliente.</p> : quotes.quotes.map((quote) => <article className="quote-item" key={quote.id}><div className="quote-title"><strong>{formattedText(quote.carrier || "Aseguradora no disponible")}</strong><small>{formattedText(quote.product || "Producto no disponible")}</small></div><dl><div><dt>Valor nominal</dt><dd>{quote.face_amount_cents === null ? "No consta" : `$${(Number(quote.face_amount_cents) / 100).toLocaleString("es-CO")}`}</dd></div><div><dt>Prima mensual</dt><dd>{quote.monthly_premium_cents === null ? "No consta" : `$${(Number(quote.monthly_premium_cents) / 100).toLocaleString("es-CO")}`}</dd></div><div><dt>Prima anual</dt><dd>{quote.annual_premium_cents === null ? "No consta" : `$${(Number(quote.annual_premium_cents) / 100).toLocaleString("es-CO")}`}</dd></div></dl></article>)}<div className="missing-block"><strong>Faltantes y limitaciones</strong><ul>{quotes.missing.map((item) => <li key={item}>{formattedText(item)}</li>)}</ul><span>{formattedText(quotes.rules.reason)}</span></div></div>}
            </div>
            <div className="panel-foot">Las cotizaciones son instantáneas analíticas; no confirman ofertas vigentes, cobertura ni aprobación.</div>
          </aside>
        </main>
      </div>
    );
  return <LoginPage busy={busy} error={error} onSubmit={login} />;
}
export default App;
