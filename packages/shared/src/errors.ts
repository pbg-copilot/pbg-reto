import { z } from "zod";

// Códigos de error comunes de la API (specs/000-overview/api-conventions.md).
export const ERROR_CODES = [
  "invalid_request",
  "unauthorized",
  "forbidden",
  "origin_not_allowed",
  "not_found",
  "version_conflict",
  "idempotency_in_progress",
  "idempotency_key_reused",
  "ticket_closed",
  "conversation_already_escalated",
  "file_too_large",
  "unsupported_file_type",
  "invalid_transition",
  "resolution_required",
  "invalid_credentials",
  "too_many_requests",
  "assistant_unavailable",
  "internal_error",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
