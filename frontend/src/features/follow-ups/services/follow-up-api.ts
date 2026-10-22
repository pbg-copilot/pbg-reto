import type { ApiRequest } from "../../../shared/api/api-client";
import type { Client, FollowUp } from "../../../shared/types/domain";

export async function listFollowUps(api: ApiRequest, conversationId: string): Promise<FollowUp[]> {
  const result = await api<{ follow_ups: FollowUp[] }>(`/api/conversations/${conversationId}/follow-ups`);
  return result.follow_ups;
}

export async function createFollowUp(api: ApiRequest, conversationId: string, client: Client, description: string, dueDate: string): Promise<FollowUp> {
  const result = await api<{ follow_up: FollowUp }>(`/api/conversations/${conversationId}/follow-ups`, {
    method: "POST", body: JSON.stringify({ description, dueDate, expectedClientPath: client.document_path, expectedClientRecordId: client.client_record_id }),
  });
  return result.follow_up;
}

export async function completeFollowUp(api: ApiRequest, conversationId: string, followUpId: string, client: Client): Promise<FollowUp> {
  const result = await api<{ follow_up: FollowUp }>(`/api/conversations/${conversationId}/follow-ups/${followUpId}/complete`, {
    method: "PATCH", body: JSON.stringify({ expectedClientPath: client.document_path, expectedClientRecordId: client.client_record_id }),
  });
  return result.follow_up;
}
