import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, LoginBody } from "@reto/shared";
import { api, ApiError } from "@/lib/api";
import { queryKeys } from "@/lib/query";

async function fetchSession(): Promise<Agent | null> {
  try {
    return (await api<{ agent: Agent }>("/auth/me")).agent;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

// Comprueba la sesión al cargar, al volver a la pestaña y cada minuto (como el repo base).
export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
    staleTime: 0,
    refetchInterval: (query) => (query.state.data ? 60_000 : false),
    refetchOnWindowFocus: true,
  });
}

export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginBody) =>
      api<{ agent: Agent }>("/auth/get-toke", { method: "POST", body }),
    onSuccess: ({ agent }) => client.setQueryData(queryKeys.session, agent),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      // No usar client.clear(): dejaría al shell observando una query de sesión borrada.
      client.setQueryData(queryKeys.session, null);
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.session[0] });
    },
  });
}
