import { QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

// Factory de query keys: cada feature agrega las suyas aquí.
export const queryKeys = {
  session: ["session"] as const,
};

export function createQueryClient() {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      // Una sesión vencida en cualquier consulta lleva de vuelta al login.
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401)
          client.setQueryData(queryKeys.session, null);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Los errores 4xx no se arreglan reintentando.
        retry: (count, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
  return client;
}
