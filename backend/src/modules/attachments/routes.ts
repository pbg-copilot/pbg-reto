import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyRequest } from "fastify";
import {
  apiErrorSchema,
  attachmentSchema,
  chatAttachmentSchema,
  formatBytes,
  removeAttachmentBodySchema,
  uploadResponseSchema,
} from "@reto/shared";
import { AppError } from "../../lib/errors.js";
import { mutationRateLimit, uploadRateLimit } from "../../lib/rate-limit.js";
import type { AttachmentService, IncomingFile } from "./service.js";

const idParams = z.object({ id: z.uuid() });
const security: Record<string, string[]>[] = [{ bearer: [] }, { cookie: [] }];
const errors = { 400: apiErrorSchema, 401: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema };
const uploadErrors = { ...errors, 409: apiErrorSchema, 413: apiErrorSchema, 415: apiErrorSchema };
const idempotencyHeader = z.looseObject({ "idempotency-key": z.string().min(8).max(128) });

const POLICY =
  "multipart/form-data con `files` (hasta 5, 10 MB c/u). Tipos: PNG, JPEG, WEBP, GIF, PDF y texto (.txt, .log), validados por su contenido (magic bytes). 415 si el tipo no se admite o no coincide con la extensión; 413 si pasa el tamaño.";

// ASCII para clientes viejos y filename* (RFC 5987) con el nombre real.
const contentDisposition = (kind: "inline" | "attachment", name: string) =>
  `${kind}; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

const attachmentRoutes: FastifyPluginAsyncZod<{ service: AttachmentService; maxBytes: number; maxFiles: number }> = async (
  app,
  { service, maxBytes, maxFiles },
) => {
  const tags = ["adjuntos"];
  const upload = { preValidation: app.requireAuth, preHandler: app.idempotent, config: { rateLimit: uploadRateLimit } };

  // Lee el multipart con límites: el archivo que pasa el tamaño corta la lectura (413).
  async function readParts(request: FastifyRequest): Promise<{ fields: Record<string, string>; files: IncomingFile[] }> {
    if (!request.isMultipart()) throw new AppError(400, "invalid_request", "Envía los archivos como multipart/form-data en el campo files.");
    const fields: Record<string, string> = {};
    const files: IncomingFile[] = [];
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") files.push({ filename: part.filename, buffer: await part.toBuffer() });
        else fields[part.fieldname] = String(part.value);
      }
    } catch (error) {
      if (error instanceof app.multipartErrors.RequestFileTooLargeError)
        throw new AppError(413, "file_too_large", `Cada archivo puede pesar hasta ${formatBytes(maxBytes)}.`);
      if (error instanceof app.multipartErrors.FilesLimitError)
        throw new AppError(400, "invalid_request", `Puedes adjuntar hasta ${maxFiles} archivos a la vez.`);
      throw error;
    }
    return { fields, files };
  }

  app.post(
    "/tickets/:id/attachments",
    {
      ...upload,
      schema: {
        tags,
        security,
        summary: "Adjuntar archivos a un ticket",
        description: `${POLICY} Campos opcionales: \`visibility\` (public | internal, solo admin) y \`comment_id\` (el adjunto hereda su visibilidad). El solicitante solo adjunta públicos a sus tickets; un ticket ajeno da 404.`,
        consumes: ["multipart/form-data"],
        headers: idempotencyHeader,
        params: idParams,
        response: { 201: uploadResponseSchema, ...uploadErrors },
      },
    },
    async (request, reply) => {
      await service.assertTicketVisible(request.actor!, request.params.id);
      const { fields, files } = await readParts(request);
      const visibility = fields.visibility === undefined ? undefined : z.enum(["public", "internal"]).safeParse(fields.visibility);
      if (visibility && !visibility.success) throw new AppError(400, "invalid_request", "visibility debe ser public o internal.");
      const commentId = fields.comment_id ? z.uuid().safeParse(fields.comment_id) : undefined;
      if (commentId && !commentId.success) throw new AppError(400, "invalid_request", "comment_id no es válido.");
      const attachments = await service.uploadToTicket(request.actor!, request.params.id, files, {
        visibility: visibility?.data,
        commentId: commentId?.data ?? null,
      });
      return reply.code(201).send({ attachments });
    },
  );

  app.post(
    "/support/conversations/:id/attachments",
    {
      ...upload,
      schema: {
        tags,
        security,
        summary: "Adjuntar evidencias en el chat",
        description: `${POLICY} Después se envían con el mensaje (\`attachment_ids\`). Al escalar, pasan al ticket.`,
        consumes: ["multipart/form-data"],
        headers: idempotencyHeader,
        params: idParams,
        response: { 201: z.object({ attachments: z.array(chatAttachmentSchema) }), ...uploadErrors },
      },
    },
    async (request, reply) => {
      const { files } = await readParts(request);
      const attachments = await service.uploadToConversation(request.actor!, request.params.id, files);
      return reply.code(201).send({ attachments });
    },
  );

  app.get(
    "/attachments/:id/download",
    {
      preValidation: app.requireAuth,
      schema: {
        tags,
        security,
        summary: "Descargar un adjunto (autorizado en cada request)",
        description:
          "Streaming desde el bucket privado. Content-Type es el tipo detectado al subir, nunca el declarado. `inline=1` solo aplica a imágenes. Ajeno, interno (para el solicitante) o retirado → 404.",
        params: idParams,
        querystring: z.object({ inline: z.enum(["0", "1"]).optional() }),
        // El cuerpo es el binario (stream): Fastify no lo serializa.
        response: { 200: z.unknown().describe("Contenido del archivo"), ...errors },
      },
    },
    async (request, reply) => {
      const file = await service.download(request.actor!, request.params.id, request.query.inline === "1");
      return reply
        .header("Content-Type", file.mime)
        .header("Content-Length", String(file.length))
        .header("Content-Disposition", contentDisposition(file.inline ? "inline" : "attachment", file.name))
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, no-store")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .send(file.stream);
    },
  );

  app.delete(
    "/attachments/:id",
    {
      preValidation: app.requireAdmin,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Retirar una evidencia (solo admin)",
        description: "Soft delete con motivo: deja de servirse y queda el registro y el evento attachment_removed.",
        params: idParams,
        body: removeAttachmentBodySchema,
        response: { 200: attachmentSchema, ...errors },
      },
    },
    async (request) => service.remove(request.actor!, request.params.id, request.body.reason),
  );
};

export default attachmentRoutes;
