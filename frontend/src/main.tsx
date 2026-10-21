import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
type Agent = {
  id: string;
  name: string;
  username: string;
  email: string;
  agency_name: string | null;
  role: string;
};
type Conversation = {
  id: string;
  title: string | null;
  status: "active" | "archived";
  active_client_path: string | null;
  active_client_record_id: string | null;
  updated_at: string;
};
type Message = {
  id: string;
  sequence_no: string;
  sender_role: "user" | "assistant" | "tool";
  content: string;
  created_at: string;
};
type Client = {
  document_path: string;
  client_record_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  stage: string | null;
};
type ClientProfile = {
  client: { id: string; name: string | null; email: string | null; phone: string | null; stage: string | null };
  source: { type: string; document_path: string; client_record_id: string; date: string | null };
  missing: string[];
  notes_status: "loaded" | "empty" | "unavailable";
  notes: Array<{ id: string; index: string; text: { original?: string | null; es?: string | null; en?: string | null }; occurred_at: string | null; source: { document_path: string; client_record_id: string; note_id: string; note_index: string; date: string | null } }>;
  activity: { status: "loaded" | "partial" | "empty" | "unavailable"; entries: Array<{ call_id: string; note_id: string; occurred_at: string; source: { document_path: string; client_record_id: string; note_id: string; note_index: string; date: string | null } }>; reason?: string | null };
};
type QuoteResponse = {
  quotes_status: "loaded" | "empty";
  quotes: Array<{ id: string; carrier: string | null; product: string | null; face_amount_cents: string | null; monthly_premium_cents: string | null; annual_premium_cents: string | null; recorded_at: string | null; source: { type: string; table: string; record_id: string; client_record_id: string; date: string | null; match_basis: string } }>;
  rules: { status: string; reason: string };
  missing: string[];
};
type Appointment = {
  id: string;
  conversation_id: string;
  client_document_path: string;
  client_record_id: string;
  agent_account_id: string;
  start_at: string;
  end_at: string;
  time_zone: string;
  local_start: string;
  start_utc_offset_minutes: number;
  status: "confirmed" | "cancelled";
};
type AppointmentAction = "create" | "reschedule" | "cancel";
type AppointmentConfirmation = {
  id: string;
  expires_at: string;
  action: AppointmentAction;
  appointment_id: string | null;
  client_document_path: string;
  client_record_id: string;
  agent_account_id: string;
  interval: {
    start_at: string;
    end_at: string;
    duration_minutes: number;
    time_zone: string;
    start_local: string;
    end_local: string;
    start_utc_offset_minutes: number;
  };
};
type AppointmentMutationResult = {
  action: AppointmentAction;
  appointment: Appointment;
  idempotent_replay?: boolean;
};
class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message); }
}
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }) : "Fecha no disponible";
const appointmentDateLabel = (appointment: Appointment) => new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeZone: appointment.time_zone }).format(new Date(appointment.start_at));
const textValue = (value: { original?: string | null; es?: string | null; en?: string | null }) => value.original ?? value.es ?? value.en ?? "Texto no disponible";
function Arrow() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </svg>
  );
}
function Chevron() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M9 5H5v14h4m5-14 7 7-7 7m7-7H9" />
    </svg>
  );
}
function App() {
  const [agent, setAgent] = useState<Agent | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [clientError, setClientError] = useState("");
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [quotes, setQuotes] = useState<QuoteResponse | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);
  const [appointmentsError, setAppointmentsError] = useState("");
  const [appointmentError, setAppointmentError] = useState("");
  const [appointmentConflict, setAppointmentConflict] = useState(false);
  const [appointmentBusy, setAppointmentBusy] = useState(false);
  const [appointmentAction, setAppointmentAction] = useState<AppointmentAction>("create");
  const [selectedAppointmentId, setSelectedAppointmentId] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [appointmentDuration, setAppointmentDuration] = useState(30);
  const [pendingAppointment, setPendingAppointment] = useState<{ confirmation: AppointmentConfirmation; idempotencyKey: string } | null>(null);
  const [appointmentResult, setAppointmentResult] = useState<AppointmentMutationResult | null>(null);
  const appointmentRequest = useRef(0);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [messageBusy, setMessageBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const contextRequest = useRef(0);
  const searchRequest = useRef(0);
  const activeConversationRef = useRef("");
  const menuRef = useRef<HTMLDivElement>(null),
    buttonRef = useRef<HTMLButtonElement>(null);
  function clearWorkspace() {
    contextRequest.current += 1; searchRequest.current += 1;
    appointmentRequest.current += 1;
    activeConversationRef.current = "";
    setConversations([]); setActiveConversationId(""); setMessages([]);
    setMessagesHasMore(false); setMessagesCursor(null); setActiveClient(null);
    setProfile(null); setQuotes(null); setMessageDraft(""); setClientQuery("");
    setAppointments([]); setAppointmentsLoading(false); setAppointmentsError(""); setAppointmentError(""); setAppointmentConflict(false); setAppointmentBusy(false); setPendingAppointment(null); setAppointmentResult(null);
    setAppointmentAction("create"); setSelectedAppointmentId(""); setAppointmentDate(""); setAppointmentTime("");
    setClientResults([]); setClientError(""); setConversationError("");
    setDetailError(""); setNotice("");
    setConversationLoading(false); setHistoryLoading(false); setClientSearchLoading(false);
    setDetailLoading(false); setMessageBusy(false);
  }
  async function restore() {
    try {
      const r = await fetch("/auth/me", { credentials: "same-origin" });
      if (r.ok) {
        const restored = (await r.json()).agent as Agent;
        if (agent && agent.id !== restored.id) clearWorkspace();
        setAgent(restored);
        setError("");
      } else if (r.status === 401) {
        setAgent(null);
        clearWorkspace();
      } else {
        setError("No pudimos conectar. Intenta de nuevo.");
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
  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(path, {
      ...init,
      credentials: "same-origin",
      headers,
    });
    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (response.status === 401) {
      setAgent(null);
      clearWorkspace();
      setError("Tu sesión venció. Inicia sesión para continuar.");
      throw new ApiError("Tu sesión venció. Inicia sesión para continuar.", 401, "unauthorized");
    }
    if (!response.ok) throw new ApiError(body?.message || "No pudimos completar la solicitud.", response.status, body?.error || "request_failed");
    return body as T;
  }
  async function loadProfile(conversationId: string, requestId = contextRequest.current) {
    setDetailLoading(true); setDetailError("");
    setQuotes(null);
    try {
      const result = await api<ClientProfile>(`/api/conversations/${conversationId}/client`);
      if (requestId === contextRequest.current) setProfile(result);
    } catch (error) {
      if (requestId !== contextRequest.current) return;
      if (error instanceof ApiError && error.status === 409 && error.code === "client_not_selected") {
        setProfile(null); return;
      }
      setDetailError(error instanceof Error ? error.message : "No se pudo cargar el expediente.");
    } finally {
      if (requestId === contextRequest.current) setDetailLoading(false);
    }
  }
  async function loadAppointments(conversationId: string, requestId = contextRequest.current) {
    setAppointmentsLoading(true); setAppointmentsError("");
    try {
      const result = await api<{ appointments: Appointment[] }>(`/api/conversations/${conversationId}/appointments`);
      if (requestId === contextRequest.current && conversationId === activeConversationRef.current) setAppointments(result.appointments);
    } catch (e) {
      if (requestId === contextRequest.current && conversationId === activeConversationRef.current && !(e instanceof ApiError && e.status === 401)) setAppointmentsError(e instanceof Error ? e.message : "No se pudieron cargar las citas.");
    } finally {
      if (requestId === contextRequest.current && conversationId === activeConversationRef.current) setAppointmentsLoading(false);
    }
  }
  function invalidateAppointmentReview() {
    appointmentRequest.current += 1;
    setPendingAppointment(null); setAppointmentResult(null); setAppointmentError(""); setAppointmentConflict(false);
  }
  async function prepareAppointment() {
    if (!activeConversationId || !activeClient || agent?.role !== "agent" || appointmentBusy) return;
    const conversationId = activeConversationId;
    const requestId = contextRequest.current;
    const appointment = appointments.find((item) => item.id === selectedAppointmentId);
    if (appointmentAction !== "create" && !appointment) {
      setAppointmentError("Selecciona una cita vigente para continuar.");
      return;
    }
    if (appointmentAction !== "cancel" && (!appointmentDate || !appointmentTime)) {
      setAppointmentError("Indica la fecha y la hora local de la cita.");
      return;
    }
    const payload: Record<string, unknown> = { action: appointmentAction };
    if (appointmentAction !== "create") payload.appointmentId = appointment!.id;
    if (appointmentAction === "create") payload.agentAccountId = agent.id;
    if (appointmentAction !== "cancel") {
      payload.localStart = `${appointmentDate}T${appointmentTime}`;
      payload.durationMinutes = appointmentDuration;
      payload.timeZone = "America/Bogota";
      if (appointmentAction === "reschedule") payload.agentAccountId = appointment!.agent_account_id;
    }
    const operationId = ++appointmentRequest.current;
    setAppointmentBusy(true); setAppointmentError(""); setAppointmentConflict(false); setAppointmentResult(null); setPendingAppointment(null);
    try {
      const result = await api<{ confirmation: AppointmentConfirmation }>(`/api/conversations/${conversationId}/appointments/confirm`, { method: "POST", body: JSON.stringify(payload) });
      if (operationId === appointmentRequest.current && requestId === contextRequest.current && conversationId === activeConversationRef.current) {
        setPendingAppointment({ confirmation: result.confirmation, idempotencyKey: crypto.randomUUID() });
      }
    } catch (e) {
      if (operationId === appointmentRequest.current && requestId === contextRequest.current && conversationId === activeConversationRef.current && !(e instanceof ApiError && e.status === 401)) setAppointmentError(e instanceof Error ? e.message : "No se pudo preparar la operación.");
    } finally {
      if (operationId === appointmentRequest.current) setAppointmentBusy(false);
    }
  }
  async function executeAppointment() {
    if (!activeConversationId || !pendingAppointment || appointmentBusy) return;
    const conversationId = activeConversationId;
    const requestId = contextRequest.current;
    const operationId = appointmentRequest.current;
    const pending = pendingAppointment;
    setAppointmentBusy(true); setAppointmentError(""); setAppointmentConflict(false); setAppointmentResult(null);
    try {
      const result = await api<AppointmentMutationResult>(`/api/conversations/${conversationId}/appointments`, { method: "POST", body: JSON.stringify({ confirmationId: pending.confirmation.id, idempotencyKey: pending.idempotencyKey }) });
      if (operationId === appointmentRequest.current && requestId === contextRequest.current && conversationId === activeConversationRef.current) {
        setAppointmentResult(result); setPendingAppointment(null); setAppointmentAction("create"); setSelectedAppointmentId("");
        await loadAppointments(conversationId, requestId);
      }
    } catch (e) {
      if (operationId === appointmentRequest.current && requestId === contextRequest.current && conversationId === activeConversationRef.current && !(e instanceof ApiError && e.status === 401)) {
        if (e instanceof ApiError && e.status === 409) { setPendingAppointment(null); setAppointmentConflict(e.code === "slot_taken"); }
        setAppointmentError(e instanceof Error ? e.message : "No se pudo completar la operación.");
      }
    } finally {
      if (operationId === appointmentRequest.current) setAppointmentBusy(false);
    }
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
      setMessages([]); setMessagesHasMore(false); setMessagesCursor(null); setActiveClient(null); setProfile(null); setQuotes(null); return;
    }
    const requestId = ++contextRequest.current;
    let cancelled = false;
    setConversationLoading(true); setConversationError(""); setDetailError("");
    setMessages([]); setMessagesHasMore(false); setMessagesCursor(null); setActiveClient(null); setProfile(null); setQuotes(null);
    setAppointments([]); setAppointmentsLoading(false); setAppointmentsError(""); setAppointmentError(""); setAppointmentConflict(false); setPendingAppointment(null); setAppointmentResult(null);
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
        await loadProfile(conversation.id, requestId);
        await loadAppointments(conversation.id, requestId);
      }
    }).catch((error) => {
      if (!cancelled && requestId === contextRequest.current && !(error instanceof ApiError && error.status === 401)) setConversationError(error instanceof Error ? error.message : "No se pudo abrir la conversación.");
    }).finally(() => { if (!cancelled && requestId === contextRequest.current) setConversationLoading(false); });
    return () => { cancelled = true; };
  }, [activeConversationId, agent?.id]);
  useEffect(() => {
    const query = clientQuery.trim();
    const requestId = ++searchRequest.current;
    if (query.length < 2) { setClientResults([]); setClientSearchLoading(false); setClientError(""); return; }
    setClientResults([]); setClientError("");
    const timer = window.setTimeout(() => {
      setClientSearchLoading(true); setClientError("");
      api<{ clients: Client[] }>(`/api/clients?q=${encodeURIComponent(query)}&limit=20`).then((result) => {
        if (requestId === searchRequest.current) setClientResults(result.clients);
      }).catch((error) => { if (requestId === searchRequest.current && !(error instanceof ApiError && error.status === 401)) setClientError(error instanceof Error ? error.message : "No se pudo buscar."); })
        .finally(() => { if (requestId === searchRequest.current) setClientSearchLoading(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [clientQuery, agent?.id]);
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
    contextRequest.current += 1;
    searchRequest.current += 1;
    appointmentRequest.current += 1;
    activeConversationRef.current = conversationId;
    setActiveConversationId(conversationId);
    setMessages([]); setMessagesHasMore(false); setMessagesCursor(null);
    setHistoryLoading(false);
    setActiveClient(null); setProfile(null); setQuotes(null);
    setAppointments([]); setAppointmentsLoading(false); setAppointmentsError(""); setAppointmentError(""); setAppointmentConflict(false); setAppointmentBusy(false); setPendingAppointment(null); setAppointmentResult(null);
    setAppointmentAction("create"); setSelectedAppointmentId(""); setAppointmentDate(""); setAppointmentTime("");
    setMessageDraft(""); setNotice(""); setClientQuery("");
    setClientResults([]); setDetailError(""); setConversationError("");
  }
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/auth/get-toke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ usuario: username, contrasena: password }),
      });
      const body = await r.json();
      if (!r.ok) {
        setError(body.message || "No fue posible iniciar sesión.");
        return;
      }
      setAgent(body.agent);
      clearWorkspace();
      setPassword("");
      setMenu(false);
    } catch {
      setError("No pudimos conectar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!r.ok) throw new Error();
      setAgent(null);
      clearWorkspace();
      setMenu(false);
      setPassword("");
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
          <aside className="conversation-rail" aria-label="Conversaciones">
            <div className="rail-heading"><div><span className="eyebrow teal">RETO · ASISTENTE</span><h1>Conversaciones</h1></div><button className="new-chat" onClick={async () => { try { const result = await api<{ conversation: Conversation }>("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Nueva conversación" }) }); setConversations((current) => [result.conversation, ...current]); activateConversation(result.conversation.id); } catch (e) { if (!(e instanceof ApiError && e.status === 401)) setConversationError(e instanceof Error ? e.message : "No se pudo crear la conversación."); } }} aria-label="Nueva conversación" title="Nueva conversación">+</button></div>
            {conversationError && <div className="inline-error" role="alert">{conversationError}</div>}
            {conversations.length === 0 && !conversationError ? <div className="rail-empty">Aún no tienes conversaciones. Crea una para empezar.</div> : <nav className="conversation-list">{conversations.map((conversation) => <button key={conversation.id} className={`conversation-item ${activeConversationId === conversation.id ? "selected" : ""}`} onClick={() => activateConversation(conversation.id)}><span className="conversation-mark" /><span className="conversation-copy"><strong>{conversation.title || "Conversación"}</strong><small>{conversation.active_client_record_id ? `Cliente · ${conversation.active_client_record_id}` : dateLabel(conversation.updated_at)}</small></span></button>)}</nav>}
            <div className="rail-foot"><span className="status-square" /> Sesión de {agent.name.split(" ")[0]}</div>
          </aside>
          <section className="chat-main" aria-label="Chat y contexto">
            {!activeConversationId ? <div className="chat-welcome"><span className="welcome-icon">R</span><span className="eyebrow teal">TU ESPACIO DE TRABAJO</span><h2>Hola, {agent.name.split(" ")[0]}.</h2><p>Crea una conversación para consultar expedientes y cotizaciones autorizadas.</p></div> : <>
              <header className="chat-heading"><div><span className="eyebrow teal">CONVERSACIÓN ACTIVA</span><h2>{conversations.find((item) => item.id === activeConversationId)?.title || "Conversación"}</h2></div><span className={`state-pill ${conversationLoading ? "loading-state" : ""}`}>{conversationLoading ? "Cargando" : "Guardada"}</span></header>
              {conversationError && <div className="inline-error wide" role="alert">{conversationError}</div>}
              <div className="chat-feed" aria-live="polite">
                {conversationLoading && <div className="feed-state"><span className="loader" /> Cargando historial y contexto…</div>}
                {!conversationLoading && messagesHasMore && <button className="load-older" onClick={() => void loadOlderMessages()} disabled={historyLoading}>{historyLoading ? "Cargando…" : "Cargar mensajes anteriores"}</button>}
                {!conversationLoading && messages.length === 0 && <div className="feed-state empty-chat"><strong>Esta conversación está lista.</strong><span>Busca un cliente para fijarlo como contexto. El historial y los resultados se mantienen separados por conversación.</span></div>}
                {messages.map((message) => <article className={`message ${message.sender_role === "user" ? "user-message" : "assistant-message"}`} key={message.id}><div className="message-avatar">{message.sender_role === "user" ? "Tú" : "R"}</div><div className="message-content"><div className="message-meta">{message.sender_role === "user" ? "Tú" : "RETO"}<time>{dateLabel(message.created_at)}</time></div><p>{message.content}</p></div></article>)}
                {notice && <div className="saved-notice" role="status">{notice}</div>}
              </div>
              <form className="composer" onSubmit={async (event) => { event.preventDefault(); const content = messageDraft.trim(); if (!content || !activeConversationId || messageBusy) return; const conversationId = activeConversationId; setMessageBusy(true); setNotice(""); try { const result = await api<{ message: Message }>(`/api/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify({ content }) }); if (conversationId === activeConversationRef.current) { setMessages((current) => [...current, result.message]); setMessageDraft(""); setNotice("Mensaje guardado en el historial."); setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, updated_at: result.message.created_at } : item)); } } catch (e) { if (conversationId === activeConversationRef.current && !(e instanceof ApiError && e.status === 401)) setConversationError(e instanceof Error ? e.message : "No se pudo guardar el mensaje."); } finally { setMessageBusy(false); } }}><label htmlFor="message-draft" className="sr-only">Escribe un mensaje</label><textarea id="message-draft" value={messageDraft} onChange={(event) => setMessageDraft(event.target.value)} placeholder="Escribe una nota o pregunta para guardar en esta conversación…" maxLength={12000} rows={2} disabled={conversationLoading || !activeConversationId} /><div className="composer-bottom"><span>Los mensajes se guardan en esta conversación.</span><button type="submit" disabled={!messageDraft.trim() || messageBusy || conversationLoading}>{messageBusy ? "Guardando…" : "Guardar mensaje"}<Arrow /></button></div></form>
            </>}
          </section>
          <aside className="context-panel" aria-label="Cliente y consultas">
            <div className="panel-section"><span className="eyebrow teal">CONTEXTO DEL EXPEDIENTE</span><h2>Cliente activo</h2>
              {activeClient ? <div className="active-client"><span className="client-avatar">{(profile?.client.name || activeClient.name).split(" ").slice(0,2).map((part) => part[0]).join("")}</span><div><strong>{profile?.client.name || activeClient.name}</strong><small>ID · {activeClient.client_record_id}</small></div></div> : <p className="muted-copy">Selecciona un cliente para consultar su perfil y sus cotizaciones.</p>}
              <label className="search-label" htmlFor="client-search">Buscar cliente</label><div className="search-box"><span aria-hidden="true">⌕</span><input id="client-search" value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Nombre, correo o ID" disabled={!activeConversationId} /></div>
              {clientSearchLoading && <p className="search-hint">Buscando dentro de tu alcance…</p>}{clientError && <div className="inline-error" role="alert">{clientError}</div>}{clientQuery.trim().length > 0 && clientQuery.trim().length < 2 && <p className="search-hint">Escribe al menos 2 caracteres.</p>}{clientResults.length > 0 && <div className="client-results" role="listbox" aria-label="Resultados de clientes">{clientResults.map((client) => <button key={`${client.document_path}#${client.client_record_id}`} role="option" aria-selected={activeClient?.client_record_id === client.client_record_id && activeClient?.document_path === client.document_path} onClick={async () => { const conversationId = activeConversationId; if (!conversationId) return; const requestId = ++contextRequest.current; searchRequest.current += 1; appointmentRequest.current += 1; setDetailLoading(true); setClientError(""); setDetailError(""); setAppointmentError(""); setAppointmentConflict(false); setAppointmentBusy(false); setAppointmentAction("create"); setSelectedAppointmentId(""); setAppointmentDate(""); setAppointmentTime(""); setAppointments([]); setPendingAppointment(null); setAppointmentResult(null); setQuotes(null); setProfile(null); setActiveClient(client); setClientQuery(""); setClientResults([]); setNotice(""); try { await api(`/api/conversations/${conversationId}/client`, { method: "POST", body: JSON.stringify({ documentPath: client.document_path, clientRecordId: client.client_record_id }) }); if (requestId === contextRequest.current && conversationId === activeConversationRef.current) { setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, active_client_path: client.document_path, active_client_record_id: client.client_record_id } : item)); await loadProfile(conversationId, requestId); await loadAppointments(conversationId, requestId); } } catch (e) { if (requestId === contextRequest.current) { setActiveClient(null); setProfile(null); if (!(e instanceof ApiError && e.status === 401)) setClientError(e instanceof Error ? e.message : "No se pudo seleccionar el cliente."); } } finally { if (requestId === contextRequest.current) setDetailLoading(false); } }}><strong>{client.name || "Sin nombre"}</strong><small>{client.email || client.client_record_id}</small><span className="result-stage">{client.stage || "Etapa no disponible"}</span></button>)}</div>}{clientQuery.trim().length >= 2 && !clientSearchLoading && !clientError && clientResults.length === 0 && <p className="search-hint">No encontramos clientes dentro de tu alcance.</p>}
            </div>
            {activeClient && <div className="panel-section lookup-actions"><span className="eyebrow teal">CONSULTAS DETERMINISTAS</span><div className="action-buttons"><button onClick={() => activeConversationId && void loadProfile(activeConversationId)} disabled={detailLoading || !activeConversationId}>Ver expediente</button><button onClick={async () => { const conversationId = activeConversationId; if (!conversationId) return; const requestId = ++contextRequest.current; setDetailLoading(true); setDetailError(""); setProfile(null); setQuotes(null); try { const response = await api<QuoteResponse>(`/api/conversations/${conversationId}/quotes`); if (requestId === contextRequest.current && conversationId === activeConversationRef.current) setQuotes(response); } catch (e) { if (requestId === contextRequest.current && !(e instanceof ApiError && e.status === 401)) setDetailError(e instanceof Error ? e.message : "No se pudieron consultar las cotizaciones."); } finally { if (requestId === contextRequest.current) setDetailLoading(false); } }} disabled={detailLoading || !activeConversationId}>Ver cotizaciones</button></div><p className="search-hint">Solo se muestran registros autorizados, con su procedencia y datos faltantes.</p></div>}
            {activeClient && agent.role === "agent" && <div className="panel-section appointment-section">
              <span className="eyebrow teal">AGENDA</span><h3>Gestionar cita</h3>
              {appointmentsLoading && <p className="search-hint">Cargando citas de este cliente…</p>}
              {appointmentsError && <div className="inline-error" role="alert">{appointmentsError}<button onClick={() => activeConversationId && void loadAppointments(activeConversationId)}>Volver a cargar citas</button></div>}
              {appointmentError && <div className="inline-error" role="alert">{appointmentError}{pendingAppointment ? <button onClick={() => void executeAppointment()}>Reintentar con la misma clave</button> : appointmentConflict ? <button onClick={() => { setAppointmentError(""); setAppointmentConflict(false); document.getElementById("appointment-date")?.focus(); }}>Cambiar horario para reintentar</button> : <button onClick={() => void prepareAppointment()}>Reintentar</button>}</div>}
              {!appointmentsLoading && !appointmentsError && appointments.length === 0 && <p className="search-hint">No hay citas confirmadas de Chat PBG para este cliente.</p>}
              {appointments.map((appointment) => <div className={`appointment-row ${selectedAppointmentId === appointment.id ? "chosen" : ""}`} key={appointment.id}>
                <div><strong>{appointmentDateLabel(appointment)}</strong><small>{appointment.local_start.slice(11, 16)} · {appointment.time_zone}</small><small>Agente · {appointment.agent_account_id}</small></div>
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
              {pendingAppointment && <div className="appointment-review" aria-live="polite"><strong>Revisa antes de confirmar</strong><span>Acción · {pendingAppointment.confirmation.action === "create" ? "Crear cita" : pendingAppointment.confirmation.action === "reschedule" ? "Reprogramar cita" : "Cancelar cita"}</span><span>Cliente · {activeClient.name} (ID {pendingAppointment.confirmation.client_record_id})</span>{pendingAppointment.confirmation.appointment_id && <span>Cita · {pendingAppointment.confirmation.appointment_id}</span>}<span>Agente · {pendingAppointment.confirmation.agent_account_id}</span><span>Inicio · {pendingAppointment.confirmation.interval.start_local}</span><span>Fin · {pendingAppointment.confirmation.interval.end_local}</span><span>Zona · {pendingAppointment.confirmation.interval.time_zone} (UTC{pendingAppointment.confirmation.interval.start_utc_offset_minutes / 60})</span><small>Confirmación vence {dateLabel(pendingAppointment.confirmation.expires_at)}. La disponibilidad se valida de nuevo al guardar.</small><div className="appointment-review-actions"><button onClick={() => void executeAppointment()} disabled={appointmentBusy}>{appointmentBusy ? "Guardando…" : "Confirmar operación"}</button><button disabled={appointmentBusy} onClick={() => { invalidateAppointmentReview(); setAppointmentBusy(false); }}>Cancelar revisión</button></div></div>}
              {appointmentResult && <div className="appointment-result" role="status"><strong>{appointmentResult.action === "create" ? "Cita creada" : appointmentResult.action === "reschedule" ? "Cita reprogramada" : "Cita cancelada"}{appointmentResult.idempotent_replay ? " · resultado recuperado" : ""}</strong><span>Registro · {appointmentResult.appointment.id}</span><span>{appointmentResult.appointment.local_start} · {appointmentResult.appointment.time_zone}</span></div>}
              <p className="search-hint">El conflicto de horario se valida al confirmar. Si otro guardado ocupa el intervalo, revisa un nuevo horario y confirma otra vez.</p>
            </div>}
            <div className="panel-section results-section"><div className="result-heading"><span className="eyebrow teal">RESULTADO Y FUENTES</span>{detailLoading && <span className="mini-loader" aria-label="Cargando" />}</div>{detailError && <div className="inline-error" role="alert">{detailError}<button onClick={() => activeConversationId && activeClient && void loadProfile(activeConversationId)}>Reintentar</button></div>}{!activeClient && <div className="panel-empty">Elige un cliente para consultar información. Las fuentes aparecerán aquí.</div>}{activeClient && !profile && !quotes && !detailLoading && !detailError && <div className="panel-empty">Usa “Ver expediente” o “Ver cotizaciones”.</div>}
              {profile && <div className="result-card"><div className="result-card-title"><span className="source-dot" /> Expediente encontrado</div><dl className="profile-fields">{[["Nombre", profile.client.name], ["Correo", profile.client.email], ["Teléfono", profile.client.phone], ["Etapa", profile.client.stage]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || <span className="missing-value">No consta</span>}</dd></div>)}</dl><div className="source-block"><strong>Fuente</strong><span>{profile.source.document_path}</span><small>Registro {profile.source.client_record_id} · {dateLabel(profile.source.date)}</small></div><div className="missing-block"><strong>Datos faltantes</strong>{profile.missing.length ? <ul>{profile.missing.map((item) => <li key={item}>{item}</li>)}</ul> : <span>No se reportan campos faltantes.</span>}</div><div className="notes-heading"><strong>Notas del expediente</strong><span>{profile.notes_status === "loaded" ? `${profile.notes.length} encontradas` : profile.notes_status === "empty" ? "Sin notas" : "No disponibles"}</span></div>{profile.notes.map((note) => <div className="note-item" key={`${note.id}-${note.index}`}><p>{textValue(note.text)}</p><small>{dateLabel(note.occurred_at)} · Fuente: {note.source.document_path} · nota {note.source.note_id}</small></div>)}{profile.activity.entries.map((entry) => <div className="note-item" key={`${entry.call_id}-${entry.note_id}`}><p>Nota vinculada a llamada {entry.call_id}</p><small>{dateLabel(entry.occurred_at)} · Fuente: {entry.source.document_path} · nota {entry.source.note_id}</small></div>)}{profile.activity.status !== "loaded" && profile.activity.status !== "empty" && profile.activity.reason && <p className="limitation-note">Actividad {profile.activity.status === "partial" ? "parcial" : "no disponible"}: {profile.activity.reason}</p>}</div>}
              {quotes && <div className="result-card"><div className="result-card-title"><span className={`source-dot ${quotes.quotes_status === "empty" ? "empty-dot" : ""}`} /> Cotizaciones {quotes.quotes_status === "empty" ? "no encontradas" : "registradas"}</div>{quotes.quotes.length === 0 ? <p className="muted-copy">No hay coincidencias exactas para este cliente.</p> : quotes.quotes.map((quote) => <article className="quote-item" key={quote.id}><div className="quote-title"><strong>{quote.carrier || "Aseguradora no disponible"}</strong><small>{quote.product || "Producto no disponible"}</small></div><dl><div><dt>Valor nominal</dt><dd>{quote.face_amount_cents === null ? "No consta" : `$${(Number(quote.face_amount_cents) / 100).toLocaleString("es-CO")}`}</dd></div><div><dt>Prima mensual</dt><dd>{quote.monthly_premium_cents === null ? "No consta" : `$${(Number(quote.monthly_premium_cents) / 100).toLocaleString("es-CO")}`}</dd></div><div><dt>Prima anual</dt><dd>{quote.annual_premium_cents === null ? "No consta" : `$${(Number(quote.annual_premium_cents) / 100).toLocaleString("es-CO")}`}</dd></div></dl><div className="source-block"><strong>Fuente</strong><span>{quote.source.table} · {quote.source.record_id}</span><small>Registro {quote.source.client_record_id} · {dateLabel(quote.source.date)}</small></div></article>)}<div className="missing-block"><strong>Faltantes y limitaciones</strong><ul>{quotes.missing.map((item) => <li key={item}>{item}</li>)}</ul><span>{quotes.rules.reason}</span></div></div>}
            </div>
            <div className="panel-foot">Las cotizaciones son instantáneas analíticas; no confirman ofertas vigentes, cobertura ni aprobación.</div>
          </aside>
        </main>
      </div>
    );
  return (
    <div className="login-layout">
      <aside className="intro">
        <div className="wordmark">
          RETO
          <span className="brand-dot" />
        </div>
        <div className="intro-body">
          <span className="eyebrow">EL SIGUIENTE PASO EMPIEZA AQUÍ</span>
          <h1>
            Las buenas ideas
            <br />
            merecen un
            <br />
            <span>gran comienzo.</span>
          </h1>
          <p>
            Un espacio para conectar información,
            <br />
            resolver y construir.
          </p>
          <div className="intro-line" />
        </div>
        <div className="intro-footer">
          <span className="status-square" />
          ENTORNO DE PRUEBA
        </div>
      </aside>
      <main className="login-main">
        <div className="mobile-brand wordmark">RETO</div>
        <form className="login-form" onSubmit={(e) => void login(e)}>
          <span className="eyebrow teal">BIENVENIDO A TU ESPACIO</span>
          <h2>Inicia sesión</h2>
          <p className="form-intro">Ingresa tus datos para continuar.</p>
          <label htmlFor="username">Usuario</label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            required
            maxLength={254}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Tu usuario o correo"
            autoCapitalize="none"
            spellCheck={false}
          />
          <label htmlFor="password">Contraseña</label>
          <div className="password-field">
            <input
              id="password"
              name="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              placeholder="Tu contraseña"
            />
            <button
              type="button"
              aria-label={
                showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
              }
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="login-button" type="submit" disabled={busy}>
            {busy ? "Ingresando…" : "Ingresar"}
            {!busy && <Arrow />}
          </button>
          <p className="demo-hint">
            <span className="small-square" />
            Entorno local de prueba con contactos e IDs sustituidos.
          </p>
        </form>
        <footer className="login-footer">
          RETO <span>Un nuevo punto de partida.</span>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
