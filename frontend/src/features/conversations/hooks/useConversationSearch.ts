import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ApiRequest } from "../../../shared/api/api-client";
import type { Conversation } from "../../../shared/types/domain";
import { listConversations } from "../services/conversation-api";

export function useConversationSearch(api: ApiRequest, agentId?: string) {
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationSearchResults, setConversationSearchResults] = useState<Conversation[] | null>(null);
  const [conversationSearchLoading, setConversationSearchLoading] = useState(false);
  const [conversationSearchError, setConversationSearchError] = useState("");
  const [revision, setRevision] = useState(0);
  const searchRequest = useRef(0);
  const refreshConversationSearch = useCallback(() => {
    setRevision((current) => current + 1);
  }, []);

  function reset() {
    searchRequest.current += 1;
    setConversationSearch("");
    setConversationSearchResults(null);
    setConversationSearchLoading(false);
    setConversationSearchError("");
  }

  useEffect(() => {
    const query = conversationSearch.trim();
    const requestId = ++searchRequest.current;
    setConversationSearchError("");
    if (!query) {
      setConversationSearchResults(null);
      setConversationSearchLoading(false);
      return;
    }
    setConversationSearchResults([]);
    setConversationSearchLoading(true);
    const timer = window.setTimeout(() => {
      void listConversations(api, query).then((conversations) => {
        if (requestId === searchRequest.current) setConversationSearchResults(conversations);
      }).catch((cause) => {
        if (requestId === searchRequest.current && !(cause instanceof ApiError && cause.status === 401))
          setConversationSearchError(cause instanceof Error ? cause.message : "No se pudo buscar en las conversaciones.");
      }).finally(() => {
        if (requestId === searchRequest.current) setConversationSearchLoading(false);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      if (requestId === searchRequest.current) searchRequest.current += 1;
    };
  }, [agentId, api, conversationSearch, revision]);

  return {
    conversationSearch, setConversationSearch, conversationSearchResults,
    conversationSearchLoading, conversationSearchError, refreshConversationSearch, reset,
  };
}
