import { ApiError } from "../../../shared/api/api-client";
import type { Client } from "../../../shared/types/domain";
import { selectConversationClient } from "../services/client-api";
import type { ClientContextOptions, ClientSelectionDependencies } from "./client-context-types";
import { useClientSearch } from "./useClientSearch";
import { useClientDetails } from "./useClientDetails";

export function useClientContext(options: ClientContextOptions) {
  const { reset: resetSearch, ...search } = useClientSearch(options.api, options.agentId);
  const { reset: resetDetails, ...details } = useClientDetails(options);

  function reset() { resetSearch(); resetDetails(); }

  async function selectClient(
    client: Client,
    dependencies: ClientSelectionDependencies,
  ) {
    const conversationId = options.activeConversationId;
    if (!conversationId) return;
    const requestId = ++options.contextRequest.current;
    details.setDetailLoading(true); resetSearch();
    try {
      await selectConversationClient(options.api, conversationId, client);
      if (requestId !== options.contextRequest.current || conversationId !== options.activeConversationRef.current) return;
      dependencies.resetAppointments();
      details.setDetailError(""); details.setQuotes(null); details.setProfile(null); options.setMessageDraft("");
      details.setActiveClient(client); options.setMessages([]); options.setMessagesHasMore(false); options.setMessagesCursor(null);
      await dependencies.reloadHistory(conversationId, requestId);
      if (requestId !== options.contextRequest.current || conversationId !== options.activeConversationRef.current) return;
      options.setConversations((current) => current.map((item) => item.id === conversationId
        ? { ...item, active_client_path: client.document_path, active_client_record_id: client.client_record_id }
        : item));
      await Promise.all([
        details.loadProfile(conversationId, requestId),
        dependencies.loadAppointments(conversationId, requestId),
      ]);
    } catch (error) {
      if (requestId === options.contextRequest.current && !(error instanceof ApiError && error.status === 401))
        search.setClientError(error instanceof Error ? error.message : "No se pudo seleccionar el cliente.");
    } finally {
      if (requestId === options.contextRequest.current) details.setDetailLoading(false);
    }
  }

  return { ...search, ...details, reset, selectClient };
}
