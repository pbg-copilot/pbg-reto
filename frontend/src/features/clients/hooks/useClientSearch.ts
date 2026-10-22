import { useEffect, useRef, useState } from "react";
import { ApiError, type ApiRequest } from "../../../shared/api/api-client";
import type { Client } from "../../../shared/types/domain";
import { searchClients } from "../services/client-api";

export function useClientSearch(api: ApiRequest, agentId?: string) {
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [clientError, setClientError] = useState("");
  const searchRequest = useRef(0);

  function reset() {
    searchRequest.current += 1;
    setClientQuery("");
    setClientResults([]);
    setClientSearchLoading(false);
    setClientError("");
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
      void searchClients(api, query)
        .then((clients) => { if (requestId === searchRequest.current) setClientResults(clients); })
        .catch((error) => {
          if (requestId === searchRequest.current && !(error instanceof ApiError && error.status === 401))
            setClientError(error instanceof Error ? error.message : "No se pudo buscar.");
        })
        .finally(() => { if (requestId === searchRequest.current) setClientSearchLoading(false); });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      if (requestId === searchRequest.current) searchRequest.current += 1;
    };
  }, [clientQuery, agentId, api]);

  return { clientQuery, setClientQuery, clientResults, clientSearchLoading, clientError, setClientError, reset };
}
