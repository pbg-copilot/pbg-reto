import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ArticleList,
  ArticleManage,
  ArticleReader,
  CreateArticleBody,
  Incident,
  IncidentBody,
  NewVersionBody,
} from "@reto/shared";
import { api } from "@/lib/api";
import { ticketKeys } from "@/features/tickets/api";

export type ArticleFilters = { q?: string; category?: string; status?: string; tag?: string; page?: string; page_size?: string };

export const catalogKeys = {
  all: ["catalog"] as const,
  lists: () => [...catalogKeys.all, "list"] as const,
  list: (filters: ArticleFilters) => [...catalogKeys.lists(), filters] as const,
  reader: (slug: string, version?: number) => [...catalogKeys.all, "reader", slug, version ?? "current"] as const,
  manage: (id: string) => [...catalogKeys.all, "manage", id] as const,
  incidents: (active: boolean) => [...catalogKeys.all, "incidents", active] as const,
};

const qs = (filters: ArticleFilters) =>
  new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();

export function useArticles(filters: ArticleFilters) {
  return useQuery({
    queryKey: catalogKeys.list(filters),
    queryFn: ({ signal }) => api<ArticleList>(`/support/articles?${qs(filters)}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useArticleReader(slug: string, version?: number) {
  return useQuery({
    queryKey: catalogKeys.reader(slug, version),
    queryFn: ({ signal }) => api<ArticleReader>(`/support/articles/${slug}${version ? `?v=${version}` : ""}`, { signal }),
  });
}

export function useArticleManage(id: string | undefined) {
  return useQuery({
    queryKey: catalogKeys.manage(id ?? "new"),
    queryFn: ({ signal }) => api<ArticleManage>(`/support/articles/${id}/manage`, { signal }),
    enabled: Boolean(id),
  });
}

function useCatalogMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<ArticleManage>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (article) => {
      client.setQueryData(catalogKeys.manage(article.id), article);
      void client.invalidateQueries({ queryKey: catalogKeys.lists() });
      void client.invalidateQueries({ queryKey: [...catalogKeys.all, "reader"] });
    },
  });
}

export const useCreateArticle = () =>
  useCatalogMutation((body: CreateArticleBody) => api<ArticleManage>("/support/articles", { method: "POST", body }));

export const useNewVersion = (id: string) =>
  useCatalogMutation((body: NewVersionBody) => api<ArticleManage>(`/support/articles/${id}/versions`, { method: "POST", body }));

export const usePublish = (id: string) =>
  useCatalogMutation((versionId: string) =>
    api<ArticleManage>(`/support/articles/${id}/publish`, { method: "POST", body: { version_id: versionId } }),
  );

export const useArchive = (id: string) =>
  useCatalogMutation(() => api<ArticleManage>(`/support/articles/${id}/archive`, { method: "POST" }));

export const useArticleFromTicket = () =>
  useCatalogMutation((ticketId: string) => api<ArticleManage>(`/support/articles/from-ticket/${ticketId}`, { method: "POST" }));

export function useIncidents(active: boolean) {
  return useQuery({
    queryKey: catalogKeys.incidents(active),
    queryFn: () => api<Incident[]>(`/support/incidents${active ? "?active=true" : ""}`),
    staleTime: 60_000,
  });
}

export function useSaveIncident() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<IncidentBody> }) =>
      id
        ? api<Incident>(`/support/incidents/${id}`, { method: "PATCH", body })
        : api<Incident>("/support/incidents", { method: "POST", body }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: [...catalogKeys.all, "incidents"] });
      void client.invalidateQueries({ queryKey: ticketKeys.all });
    },
  });
}
