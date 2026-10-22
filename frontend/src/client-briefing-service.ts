import type { Appointment, ClientProfile, QuoteResponse } from "./domain";
import type { ApiRequest } from "./appointment-api";

export type ClientBriefing = {
  profile: ClientProfile;
  quotes: QuoteResponse;
  appointments: Appointment[];
};

export async function loadClientBriefing(
  api: ApiRequest,
  conversationId: string,
): Promise<ClientBriefing> {
  const [profile, quotesResult, appointmentsResult] = await Promise.all([
    api<ClientProfile>(`/api/conversations/${conversationId}/client?limit=5`),
    api<QuoteResponse>(`/api/conversations/${conversationId}/quotes`),
    api<{ appointments: Appointment[] }>(
      `/api/conversations/${conversationId}/appointments`,
    ),
  ]);

  return {
    profile,
    quotes: quotesResult,
    appointments: appointmentsResult.appointments,
  };
}
