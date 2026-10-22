import type { ApiRequest } from "../../../shared/api/api-client";
import type { Client, ClientProfile, QuoteResponse } from "../../../shared/types/domain";

export async function searchClients(api: ApiRequest, query: string): Promise<Client[]> {
  const result = await api<{ clients: Client[] }>(`/api/clients?q=${encodeURIComponent(query)}&limit=20`);
  return result.clients;
}

export function loadClientProfile(api: ApiRequest, conversationId: string, limit?: number): Promise<ClientProfile> {
  const pagination = limit === undefined ? "" : `?limit=${limit}`;
  return api<ClientProfile>(`/api/conversations/${conversationId}/client${pagination}`);
}

export function loadClientQuotes(api: ApiRequest, conversationId: string): Promise<QuoteResponse> {
  return api<QuoteResponse>(`/api/conversations/${conversationId}/quotes`);
}

export function selectConversationClient(api: ApiRequest, conversationId: string, client: Client): Promise<unknown> {
  return api(`/api/conversations/${conversationId}/client`, {
    method: "POST",
    body: JSON.stringify({ documentPath: client.document_path, clientRecordId: client.client_record_id }),
  });
}
