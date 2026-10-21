import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Conversation, ConversationState, ResolutionBody, TurnResponse } from "@reto/shared";
import { api } from "@/lib/api";
import { ticketKeys } from "@/features/tickets/api";

export const supportChatKeys = {
  all: ["conversations"] as const,
  list: () => [...supportChatKeys.all, "list"] as const,
  detail: (id: string) => [...supportChatKeys.all, "detail", id] as const,
};

export function useConversations() {
  return useQuery({ queryKey: supportChatKeys.list(), queryFn: () => api<ConversationState[]>("/support/conversations") });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: supportChatKeys.detail(id ?? "none"),
    queryFn: ({ signal }) => api<Conversation>(`/support/conversations/${id}`, { signal }),
    enabled: Boolean(id),
  });
}

export function useCreateConversation() {
  return useMutation({
    mutationFn: (idempotencyKey: string) => api<Conversation>("/support/conversations", { method: "POST", idempotencyKey }),
  });
}

// Cada turno refresca la conversación (fuente de verdad: el servidor) y, si se creó un ticket, las listas.
function useTurn<TVariables>(mutationFn: (variables: TVariables) => Promise<TurnResponse>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSettled: (data, _error, variables) => {
      const id = data?.conversation.id ?? (variables as { id?: string }).id;
      if (id) void client.invalidateQueries({ queryKey: supportChatKeys.detail(id) });
      void client.invalidateQueries({ queryKey: supportChatKeys.list() });
      if (data?.conversation.ticket) void client.invalidateQueries({ queryKey: ticketKeys.lists() });
    },
  });
}

export const useSendMessage = () =>
  useTurn(({ id, text, idempotencyKey }: { id: string; text: string; idempotencyKey: string }) =>
    api<TurnResponse>(`/support/conversations/${id}/messages`, { method: "POST", body: { text }, idempotencyKey }),
  );

export const useResolution = () =>
  useTurn(({ id, body, idempotencyKey }: { id: string; body: ResolutionBody; idempotencyKey: string }) =>
    api<TurnResponse>(`/support/conversations/${id}/resolution`, { method: "POST", body, idempotencyKey }),
  );

export const useEscalate = () =>
  useTurn(({ id, note, idempotencyKey }: { id: string; note?: string; idempotencyKey: string }) =>
    api<TurnResponse>(`/support/conversations/${id}/escalate`, { method: "POST", body: note ? { note } : {}, idempotencyKey }),
  );
