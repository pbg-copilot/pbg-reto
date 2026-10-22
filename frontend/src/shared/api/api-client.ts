export type ApiRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit | undefined,
  onUnauthorized: () => void,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, credentials: "same-origin", headers });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (response.status === 401) {
    onUnauthorized();
    throw new ApiError("Tu sesión venció. Inicia sesión para continuar.", 401, "unauthorized");
  }
  if (!response.ok) throw new ApiError(
    body?.message || "No pudimos completar la solicitud.",
    response.status,
    body?.error || "request_failed",
  );
  return body as T;
}
