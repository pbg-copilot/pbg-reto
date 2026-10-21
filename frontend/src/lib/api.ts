import type { ApiErrorBody } from "@reto/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  // Mismo valor en cada reintento de la misma intención del usuario.
  idempotencyKey?: string;
  signal?: AbortSignal;
};

const NETWORK_ERROR = "No pudimos conectar. Intenta de nuevo.";

// Cliente HTTP de la app: cookie de sesión same-origin y errores tipados.
// No reintenta mutaciones por su cuenta; el reintento lo decide la UI.
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let response: Response;
  try {
    // nginx y Vite reenvían /api/… a la API sin el prefijo.
    response = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "network_error", NETWORK_ERROR);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data: unknown = text ? safeJson(text) : undefined;
  if (!response.ok) {
    const body = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      response.status,
      body.error ?? "internal_error",
      body.message ?? "No fue posible completar la solicitud.",
      body.details,
    );
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
