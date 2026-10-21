import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Delivery, Notification, NotificationList } from "@reto/shared";
import { api } from "@/lib/api";

export const notificationKeys = {
  all: ["notifications"] as const,
  unreadCount: () => [...notificationKeys.all, "unread-count"] as const,
  list: (filters: { unread?: boolean; page?: number; page_size?: number }) => [...notificationKeys.all, "list", filters] as const,
  deliveries: (ticketId: string) => ["tickets", "deliveries", ticketId] as const,
};

// Polling cada 20 s y al volver a la pestaña (AC-005.6). El tiempo real por SSE queda como mejora.
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount(),
    queryFn: ({ signal }) => api<{ count: number }>("/notifications/unread-count", { signal }),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    select: (data) => data.count,
  });
}

export function useNotifications(filters: { unread?: boolean; page?: number; page_size?: number }, options: { enabled?: boolean } = {}) {
  const params = new URLSearchParams();
  if (filters.unread) params.set("unread", "true");
  if (filters.page) params.set("page", String(filters.page));
  if (filters.page_size) params.set("page_size", String(filters.page_size));
  return useQuery({
    queryKey: notificationKeys.list(filters),
    queryFn: ({ signal }) => api<NotificationList>(`/notifications?${params}`, { signal }),
    placeholderData: keepPreviousData,
    refetchInterval: 20_000,
    enabled: options.enabled ?? true,
  });
}

export function useMarkRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<Notification>(`/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ updated: number }>("/notifications/read-all", { method: "POST" }),
    onSuccess: () => void client.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

// Panel admin: se refresca solo mientras haya correos pendientes.
export function useDeliveries(ticketId: string, enabled: boolean) {
  return useQuery({
    queryKey: notificationKeys.deliveries(ticketId),
    queryFn: ({ signal }) => api<Delivery[]>(`/tickets/${ticketId}/deliveries`, { signal }),
    enabled,
    refetchInterval: (query) => (query.state.data?.some((d) => d.status === "pending") ? 5_000 : 30_000),
  });
}

export function useRetryDelivery(ticketId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) => api<void>(`/notifications/deliveries/${deliveryId}/retry`, { method: "POST" }),
    onSettled: () => void client.invalidateQueries({ queryKey: notificationKeys.deliveries(ticketId) }),
  });
}
