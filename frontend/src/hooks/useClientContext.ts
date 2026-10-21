import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Client, ClientProfile, Conversation, Message, QuoteResponse } from "../domain";
import { ApiError } from "../api-client";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Options = {
  api: Api;
  agentId: string | undefined;
  activeConversationId: string;
  contextRequest: MutableRefObject<number>;
  activeConversationRef: MutableRefObject<string>;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setMessagesHasMore: Dispatch<SetStateAction<boolean>>;
  setMessagesCursor: Dispatch<SetStateAction<string | null>>;
  setMessageDraft: Dispatch<SetStateAction<string>>;
};

export function useClientContext(options: Options) {
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [clientError, setClientError] = useState("");
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [quotes, setQuotes] = useState<QuoteResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const searchRequest = useRef(0);

  function reset() {
    searchRequest.current += 1;
    setClientQuery(""); setClientResults([]); setClientSearchLoading(false); setClientError("");
    setActiveClient(null); setProfile(null); setQuotes(null); setDetailLoading(false); setDetailError("");
  }

  async function loadProfile(conversationId: string, requestId = options.contextRequest.current) {
    setDetailLoading(true); setDetailError(""); setQuotes(null);
    try {
      const result = await options.api<ClientProfile>(`/api/conversations/${conversationId}/client`);
      if (requestId === options.contextRequest.current) setProfile(result);
    } catch (error) {
      if (requestId !== options.contextRequest.current) return;
      if (error instanceof ApiError && error.status === 409 && error.code === "client_not_selected") {
        setProfile(null);
        return;
      }
      setDetailError(error instanceof Error ? error.message : "No se pudo cargar el expediente.");
    } finally {
      if (requestId === options.contextRequest.current) setDetailLoading(false);
    }
  }

  async function loadQuotes(conversationId: string, requestId = ++options.contextRequest.current) {
    setDetailLoading(true); setDetailError(""); setProfile(null); setQuotes(null);
    try {
      const result = await options.api<QuoteResponse>(`/api/conversations/${conversationId}/quotes`);
      if (requestId === options.contextRequest.current && conversationId === options.activeConversationRef.current) setQuotes(result);
    } catch (error) {
      if (requestId === options.contextRequest.current && !(error instanceof ApiError && error.status === 401))
        setDetailError(error instanceof Error ? error.message : "No se pudieron consultar las cotizaciones.");
    } finally {
      if (requestId === options.contextRequest.current) setDetailLoading(false);
    }
  }

  useEffect(() => {
    const query = clientQuery.trim();
    const requestId = ++searchRequest.current;
    if (query.length < 2) {
      setClientResults([]); setClientSearchLoading(false); setClientError("");
      return;
    }
    setClientResults([]); setClientError("");
    const timer = window.setTimeout(() => {
      setClientSearchLoading(true); setClientError("");
      void options.api<{ clients: Client[] }>(`/api/clients?q=${encodeURIComponent(query)}&limit=20`)
        .then((result) => { if (requestId === searchRequest.current) setClientResults(result.clients); })
        .catch((error) => {
          if (requestId === searchRequest.current && !(error instanceof ApiError && error.status === 401))
            setClientError(error instanceof Error ? error.message : "No se pudo buscar.");
        })
        .finally(() => { if (requestId === searchRequest.current) setClientSearchLoading(false); });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [clientQuery, options.agentId]);

  async function selectClient(
    client: Client,
    dependencies: {
      resetAppointments: () => void;
      reloadHistory: (conversationId: string, requestId: number) => Promise<void>;
      loadAppointments: (conversationId: string, requestId: number) => Promise<void>;
    },
  ) {
    const conversationId = options.activeConversationId;
    if (!conversationId) return;
    const requestId = ++options.contextRequest.current;
    searchRequest.current += 1;
    setDetailLoading(true); setClientError(""); setClientQuery(""); setClientResults([]);
    try {
      await options.api(`/api/conversations/${conversationId}/client`, {
        method: "POST",
        body: JSON.stringify({ documentPath: client.document_path, clientRecordId: client.client_record_id }),
      });
      if (requestId !== options.contextRequest.current || conversationId !== options.activeConversationRef.current) return;
      dependencies.resetAppointments();
      setDetailError(""); setQuotes(null); setProfile(null); options.setMessageDraft("");
      setActiveClient(client); options.setMessages([]); options.setMessagesHasMore(false); options.setMessagesCursor(null);
      await dependencies.reloadHistory(conversationId, requestId);
      options.setConversations((current) => current.map((item) => item.id === conversationId
        ? { ...item, active_client_path: client.document_path, active_client_record_id: client.client_record_id }
        : item));
      await Promise.all([
        loadProfile(conversationId, requestId),
        dependencies.loadAppointments(conversationId, requestId),
      ]);
    } catch (error) {
      if (requestId === options.contextRequest.current && !(error instanceof ApiError && error.status === 401))
        setClientError(error instanceof Error ? error.message : "No se pudo seleccionar el cliente.");
    } finally {
      if (requestId === options.contextRequest.current) setDetailLoading(false);
    }
  }

  return {
    clientQuery, setClientQuery, clientResults, clientSearchLoading, clientError, setClientError,
    activeClient, setActiveClient, profile, setProfile, quotes, setQuotes,
    detailLoading, setDetailLoading, detailError, setDetailError,
    reset, loadProfile, loadQuotes, selectClient,
  };
}
