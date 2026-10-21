import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssistantAction, Conversation, ConversationList, ResolutionBody, TurnResponse } from "@reto/shared";
import { api } from "@/lib/api";
import { ticketKeys } from "@/features/tickets/api";

export const supportChatKeys = {
  all: ["conversations"] as const,
  list: () => [...supportChatKeys.all, "list"] as const,
  detail: (id: string) => [...supportChatKeys.all, "detail", id] as const,
};

const CONVERSATIONS_PAGE = 10;

// "Ver más" en el panel de conversaciones: páginas de 10, máximo 10 páginas en memoria.
export function useConversations() {
  return useInfiniteQuery({
    queryKey: supportChatKeys.list(),
    queryFn: ({ pageParam, signal }) =>
      api<ConversationList>(`/support/conversations?page=${pageParam}&page_size=${CONVERSATIONS_PAGE}`, { signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
    maxPages: 10,
  });
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
  useTurn(
    ({ id, text, attachmentIds = [], shareImages = false, idempotencyKey }: { id: string; text: string; attachmentIds?: string[]; shareImages?: boolean; idempotencyKey: string }) =>
      api<TurnResponse>(`/support/conversations/${id}/messages`, {
        method: "POST",
        body: { text, attachment_ids: attachmentIds, share_images_with_ai: shareImages },
        idempotencyKey,
      }),
  );

export const useResolution = () =>
  useTurn(({ id, body, idempotencyKey }: { id: string; body: ResolutionBody; idempotencyKey: string }) =>
    api<TurnResponse>(`/support/conversations/${id}/resolution`, { method: "POST", body, idempotencyKey }),
  );

export const useEscalate = () =>
  useTurn(({ id, note, idempotencyKey }: { id: string; note?: string; idempotencyKey: string }) =>
    api<TurnResponse>(`/support/conversations/${id}/escalate`, { method: "POST", body: note ? { note } : {}, idempotencyKey }),
  );

// Confirmar o cancelar una propuesta del asistente. Una clave por clic: confirmar es idempotente
// en el servidor igual (una propuesta confirmada devuelve el mismo resultado).
export function useActionDecision(conversationId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ actionId, kind }: { actionId: string; kind: "confirm" | "cancel" }) =>
      api<AssistantAction>(`/support/conversations/${conversationId}/actions/${actionId}/${kind}`, {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
      }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: supportChatKeys.detail(conversationId) });
      void client.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}
