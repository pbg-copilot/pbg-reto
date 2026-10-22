import type { Appointment, ClientProfile, QuoteResponse } from "../../../shared/types/domain";
import type { ApiRequest } from "../../../shared/api/api-client";
import { loadClientProfile, loadClientQuotes } from "./client-api";
import { listAppointments } from "../../appointments/services/appointment-api";

export type ClientBriefing = {
  profile: ClientProfile;
  quotes: QuoteResponse;
  appointments: Appointment[];
};

export async function loadClientBriefing(
  api: ApiRequest,
  conversationId: string,
): Promise<ClientBriefing> {
  const [profile, quotesResult, appointments] = await Promise.all([
    loadClientProfile(api, conversationId, 5),
    loadClientQuotes(api, conversationId),
    listAppointments(api, conversationId),
  ]);

  return {
    profile,
    quotes: quotesResult,
    appointments,
  };
}
