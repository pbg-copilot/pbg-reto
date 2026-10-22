import { useState } from "react";
import { ApiError } from "../../../shared/api/api-client";
import type { Client, ClientProfile, QuoteResponse } from "../../../shared/types/domain";
import { loadClientProfile, loadClientQuotes } from "../services/client-api";
import type { ClientContextOptions } from "./client-context-types";

type Options = Pick<ClientContextOptions, "api" | "contextRequest" | "activeConversationRef">;

export function useClientDetails(options: Options) {
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [quotes, setQuotes] = useState<QuoteResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  function reset() {
    setActiveClient(null); setProfile(null); setQuotes(null); setDetailLoading(false); setDetailError("");
  }

  async function loadProfile(conversationId: string, requestId = options.contextRequest.current) {
    setDetailLoading(true); setDetailError(""); setQuotes(null);
    try {
      const result = await loadClientProfile(options.api, conversationId);
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
      const result = await loadClientQuotes(options.api, conversationId);
      if (requestId === options.contextRequest.current && conversationId === options.activeConversationRef.current) setQuotes(result);
    } catch (error) {
      if (requestId === options.contextRequest.current && !(error instanceof ApiError && error.status === 401))
        setDetailError(error instanceof Error ? error.message : "No se pudieron consultar las cotizaciones.");
    } finally {
      if (requestId === options.contextRequest.current) setDetailLoading(false);
    }
  }

  return {
    activeClient, setActiveClient, profile, setProfile, quotes, setQuotes,
    detailLoading, setDetailLoading, detailError, setDetailError, loadProfile, loadQuotes, reset,
  };
}
