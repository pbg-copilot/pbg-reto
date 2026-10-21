import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Metrics, Priority, UpdatePriorityBody } from "@reto/shared";
import { api } from "@/lib/api";
import { supportKeys } from "@/features/tickets/api";

export const metricsKeys = {
  range: (from: string, to: string) => ["metrics", from, to] as const,
};

export function useMetrics(from: string, to: string) {
  return useQuery({
    queryKey: metricsKeys.range(from, to),
    queryFn: ({ signal }) => api<Metrics>(`/support/metrics?from=${from}&to=${to}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export function useUpdatePriority() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ code, body }: { code: string; body: UpdatePriorityBody }) =>
      api<Priority>(`/support/priorities/${code}`, { method: "PATCH", body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: supportKeys.priorities });
      void client.invalidateQueries({ queryKey: ["metrics"] });
    },
  });
}

// Duraciones legibles: "45 min", "3 h 20 min", "2 d 4 h".
export function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}

export const formatMinutesTarget = (minutes: number | null | undefined) => (minutes ? formatDuration(minutes * 60) : null);
