import fp from "fastify-plugin";
import type { FastifyError } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { AppError } from "../lib/errors.js";

type FieldErrors = Record<string, string>;

function fieldsFrom(error: FastifyError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.validation ?? []) {
    const path = issue.instancePath.replace(/^\//, "").replaceAll("/", ".");
    const params = issue.params as { issue?: { path?: PropertyKey[] } } | undefined;
    const key = path || params?.issue?.path?.join(".") || "body";
    fields[key] ??= issue.message ?? "Valor inválido";
  }
  return fields;
}

export default fp(async function errorsPlugin(app) {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      });
    if (hasZodFastifySchemaValidationErrors(error) || error.validation)
      return reply.code(400).send({
        error: "invalid_request",
        message: "Revisa los datos enviados.",
        details: { fields: fieldsFrom(error) },
      });
    if (error.statusCode === 429)
      return reply.code(429).send({
        error: "too_many_requests",
        message: "Demasiados intentos. Espera un minuto.",
      });
    if (error.statusCode === 413)
      return reply.code(413).send({
        error: "file_too_large",
        message: "El contenido supera el tamaño permitido.",
      });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
      return reply.code(400).send({
        error: "invalid_request",
        message: "Revisa los datos enviados.",
      });
    request.log.error({ code: error.code, err: { type: error.name } }, "Request failed");
    return reply.code(500).send({
      error: "internal_error",
      message: "No fue posible completar la solicitud.",
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: "not_found", message: "No encontramos lo que buscas." }),
  );
});
