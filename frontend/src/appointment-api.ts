import type {
  Appointment,
  AppointmentAction,
  AppointmentChatKind,
  AppointmentConfirmation,
  AppointmentMutationResult,
  Message,
} from "./domain";

export type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export type AppointmentPreparePayload = {
  action: AppointmentAction;
  appointmentId?: string;
  agentAccountId?: string;
  localStart?: string;
  durationMinutes?: number;
  timeZone?: string;
};

export type AppointmentChatTurn = {
  content: string;
  kind: AppointmentChatKind;
  expectedClientPath: string;
  expectedClientRecordId: string;
  confirmationId?: string;
  appointmentId?: string;
};

export async function listAppointments(api: ApiRequest, conversationId: string): Promise<Appointment[]> {
  const result = await api<{ appointments: Appointment[] }>(
    `/api/conversations/${conversationId}/appointments`,
  );
  return result.appointments;
}

export function getAppointmentChatState(api: ApiRequest, conversationId: string) {
  return api<{
    state: "idle" | "details" | "confirmation";
    confirmation?: AppointmentConfirmation;
  }>(`/api/conversations/${conversationId}/appointment-chat/state`);
}

export function sendAppointmentChatTurn(
  api: ApiRequest,
  conversationId: string,
  turn: AppointmentChatTurn,
) {
  return api<{ messages: Message[] }>(
    `/api/conversations/${conversationId}/appointment-chat`,
    { method: "POST", body: JSON.stringify(turn) },
  );
}

export function prepareAppointment(
  api: ApiRequest,
  conversationId: string,
  payload: AppointmentPreparePayload,
) {
  return api<{ confirmation: AppointmentConfirmation }>(
    `/api/conversations/${conversationId}/appointments/confirm`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export function executeAppointment(
  api: ApiRequest,
  conversationId: string,
  confirmationId: string,
  idempotencyKey: string,
) {
  return api<AppointmentMutationResult>(
    `/api/conversations/${conversationId}/appointments`,
    { method: "POST", body: JSON.stringify({ confirmationId, idempotencyKey }) },
  );
}
