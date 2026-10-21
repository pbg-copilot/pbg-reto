import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MetricGroup, Metrics, Operations, Priority, UpdatePriorityBody } from "@reto/shared";
import { api, apiDownload } from "@/lib/api";
import { supportKeys } from "@/features/tickets/api";

export const metricsKeys = {
  range: (from: string, to: string, group: MetricGroup) => ["metrics", from, to, group] as const,
};

const rangeQuery = (from: string, to: string, group: MetricGroup) => new URLSearchParams({ from, to, group }).toString();

// El rango no es en vivo: se cachea un minuto y se vuelve a pedir al volver a la pestaña.
export function useMetrics(from: string, to: string, group: MetricGroup) {
  return useQuery({
    queryKey: metricsKeys.range(from, to, group),
    queryFn: ({ signal }) => api<Metrics>(`/support/metrics?${rangeQuery(from, to, group)}`, { signal }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

// Exportar a Excel (AC-007.20): el servidor arma el .xlsx del mismo rango y agrupación.
export function useExportMetrics() {
  return useMutation({
    mutationFn: ({ from, to, group }: { from: string; to: string; group: MetricGroup }) =>
      apiDownload(`/support/metrics/export?${rangeQuery(from, to, group)}`, `metricas-soporte-${from}-a-${to}.xlsx`),
  });
}

// Estado en vivo: se refresca cada minuto y al volver a la pestaña.
export function useOperations() {
  return useQuery({
    queryKey: ["metrics", "operations"],
    queryFn: ({ signal }) => api<Operations>("/support/metrics/operations", { signal }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
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
