import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssignBody,
  Category,
  ChangeStatusBody,
  CommentBody,
  CreateTicketBody,
  Priority,
  ReopenBody,
  SupportAdmin,
  TicketComment,
  TicketDetail,
  TicketList,
  UpdateTicketBody,
} from "@reto/shared";
import { api, ApiError } from "@/lib/api";

export type TicketFilters = {
  view?: string;
  q?: string;
  category?: string;
  priority?: string;
  assignee?: string;
  age?: string;
  unread?: string;
  unattended?: string;
  sort?: string;
  order?: string;
  page?: string;
  page_size?: string;
};

// Query keys jerárquicas: invalidar ["tickets"] refresca listas y detalles.
export const ticketKeys = {
  all: ["tickets"] as const,
  lists: () => [...ticketKeys.all, "list"] as const,
  list: (filters: TicketFilters) => [...ticketKeys.lists(), filters] as const,
  detail: (id: string) => [...ticketKeys.all, "detail", id] as const,
};

export const supportKeys = {
  categories: ["support", "categories"] as const,
  priorities: ["support", "priorities"] as const,
  admins: ["support", "admins"] as const,
};

const toQueryString = (filters: TicketFilters) =>
  new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();

export function useTicketList(filters: TicketFilters, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ticketKeys.list(filters),
    queryFn: ({ signal }) => api<TicketList>(`/tickets?${toQueryString(filters)}`, { signal }),
    placeholderData: keepPreviousData,
    // Las notificaciones (spec 005) refrescarán en tiempo casi real; mientras tanto, polling.
    refetchInterval: 30_000,
    enabled: options.enabled ?? true,
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketKeys.detail(id),
    queryFn: ({ signal }) => api<TicketDetail>(`/tickets/${id}`, { signal }),
    refetchInterval: 30_000,
  });
}

// Catálogos casi estáticos: se cachean varios minutos.
export function useCategories() {
  return useQuery({
    queryKey: supportKeys.categories,
    queryFn: () => api<Category[]>("/support/categories"),
    staleTime: 10 * 60_000,
  });
}

export function usePriorities() {
  return useQuery({
    queryKey: supportKeys.priorities,
    queryFn: () => api<Priority[]>("/support/priorities"),
    staleTime: 10 * 60_000,
  });
}

export function useAdmins(enabled: boolean) {
  return useQuery({
    queryKey: supportKeys.admins,
    queryFn: () => api<SupportAdmin[]>("/support/admins"),
    staleTime: 10 * 60_000,
    enabled,
  });
}

export const isVersionConflict = (error: unknown): error is ApiError & { details: { current: TicketDetail } } =>
  error instanceof ApiError && error.code === "version_conflict" && Boolean(error.details?.current);

// Mutación sobre un ticket: actualiza el detalle en caché e invalida las listas.
// Ante un conflicto de versión, deja en caché la versión actual del servidor.
function useTicketMutation<TVariables>(id: string, mutationFn: (variables: TVariables) => Promise<TicketDetail>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (ticket) => {
      client.setQueryData(ticketKeys.detail(id), ticket);
      void client.invalidateQueries({ queryKey: ticketKeys.lists() });
    },
    onError: (error) => {
      if (isVersionConflict(error)) client.setQueryData(ticketKeys.detail(id), error.details.current);
    },
  });
}

export const useChangeStatus = (id: string) =>
  useTicketMutation(id, (body: ChangeStatusBody) => api<TicketDetail>(`/tickets/${id}/status`, { method: "PATCH", body }));

export const useAssign = (id: string) =>
  useTicketMutation(id, (body: AssignBody) => api<TicketDetail>(`/tickets/${id}/assignee`, { method: "PATCH", body }));

export const useUpdateTicket = (id: string) =>
  useTicketMutation(id, (body: UpdateTicketBody) => api<TicketDetail>(`/tickets/${id}`, { method: "PATCH", body }));

export const useReopen = (id: string) =>
  useTicketMutation(id, ({ body, idempotencyKey }: { body: ReopenBody; idempotencyKey: string }) =>
    api<TicketDetail>(`/tickets/${id}/reopen`, { method: "POST", body, idempotencyKey }),
  );

export function useAddComment(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CommentBody; idempotencyKey: string }) =>
      api<TicketComment>(`/tickets/${id}/comments`, { method: "POST", body, idempotencyKey }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ticketKeys.detail(id) });
      void client.invalidateQueries({ queryKey: ticketKeys.lists() });
    },
  });
}

export function useCreateTicket() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: { body: CreateTicketBody; idempotencyKey: string }) =>
      api<TicketDetail>("/tickets", { method: "POST", body, idempotencyKey }),
    onSuccess: (ticket) => {
      client.setQueryData(ticketKeys.detail(ticket.id), ticket);
      void client.invalidateQueries({ queryKey: ticketKeys.lists() });
    },
  });
}
