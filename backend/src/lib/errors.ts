import type { ErrorCode } from "@reto/shared";

// Error de dominio con el formato común { error, message, details }.
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () =>
  new AppError(401, "unauthorized", "Inicia sesión para continuar.");

export const forbidden = (message = "No tienes permiso para hacer esto.") =>
  new AppError(403, "forbidden", message);

export const notFound = (message = "No encontramos lo que buscas.") =>
  new AppError(404, "not_found", message);
