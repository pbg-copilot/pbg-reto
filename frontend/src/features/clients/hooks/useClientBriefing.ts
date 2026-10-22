import { useState, type MutableRefObject } from "react";
import type { ApiRequest } from "../../../shared/api/api-client";
import { loadClientBriefing, type ClientBriefing } from "../services/client-briefing-service";

type Options = {
  api: ApiRequest;
  conversationId: string;
  hasClient: boolean;
  contextRequest: MutableRefObject<number>;
  activeConversationRef: MutableRefObject<string>;
};

export function useClientBriefing({ api, conversationId, hasClient, contextRequest, activeConversationRef }: Options) {
  const [briefing, setBriefing] = useState<ClientBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function reset() { setBriefing(null); setLoading(false); setError(""); }

  async function load() {
    if (!conversationId || !hasClient || loading) return;
    const requestId = contextRequest.current;
    const isCurrent = () => requestId === contextRequest.current && conversationId === activeConversationRef.current;
    setBriefing(null); setError(""); setLoading(true);
    try {
      const result = await loadClientBriefing(api, conversationId);
      if (isCurrent()) setBriefing(result);
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : "No se pudo preparar la ficha del cliente.");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  return { briefing, loading, error, reset, load, clearError: () => setError("") };
}
