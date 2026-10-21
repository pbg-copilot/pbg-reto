import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { isAdmin, isImageMime, type Agent, type Attachment, type AttachmentMime } from "@reto/shared";
import type { Database } from "../../db/kysely.js";
import { AppError, forbidden, notFound } from "../../lib/errors.js";
import { recordEvent } from "../tickets/events.js";
import * as ticketsRepo from "../tickets/repository.js";
import { findDownloadable, findListed, toChatAttachment } from "./repository.js";
import type { AttachmentStorage } from "./storage.js";
import { detectType, sanitizeFilename } from "./validation.js";

export type IncomingFile = { filename: string; buffer: Buffer };
type Checked = { name: string; mime: AttachmentMime; buffer: Buffer; sha256: string; key: string };

const ticketNotFound = () => notFound("No encontramos este ticket o no tienes acceso a él.");
const attachmentNotFound = () => notFound("No encontramos este archivo o no tienes acceso a él.");

// Valida todo antes de subir nada: un archivo rechazado no deja binarios en S3 (AC-006.3).
async function check(files: IncomingFile[], prefix: string): Promise<Checked[]> {
  if (files.length === 0) throw new AppError(400, "invalid_request", "Adjunta al menos un archivo.");
  const checked: Checked[] = [];
  for (const file of files) {
    const name = sanitizeFilename(file.filename);
    const mime = await detectType(file.buffer, name);
    checked.push({ name, mime, buffer: file.buffer, sha256: createHash("sha256").update(file.buffer).digest("hex"), key: `${prefix}/${randomUUID()}` });
  }
  return checked;
}

export function createAttachmentService({ db, storage }: { db: Database; storage: AttachmentStorage }) {
  // Sube a S3 antes de la transacción; si la transacción falla, borra lo subido (compensación).
  async function storeThenCommit<T>(checked: Checked[], commit: () => Promise<T>): Promise<T> {
    const uploaded: string[] = [];
    try {
      for (const file of checked) {
        await storage.put(file.key, file.buffer, file.mime);
        uploaded.push(file.key);
      }
      return await commit();
    } catch (error) {
      await Promise.allSettled(uploaded.map((key) => storage.delete(key)));
      throw error;
    }
  }

  return {
    // Se llama antes de leer el multipart: un ticket ajeno responde 404 sin recibir los archivos.
    async assertTicketVisible(actor: Agent, ticketId: string) {
      if (!(await ticketsRepo.findVisibleTicket(db, actor, ticketId))) throw ticketNotFound();
    },

    async uploadToTicket(
      actor: Agent,
      ticketId: string,
      files: IncomingFile[],
      options: { visibility?: "public" | "internal"; commentId?: string | null },
    ): Promise<Attachment[]> {
      const admin = isAdmin(actor);
      // Permisos antes de mirar los archivos: un ticket ajeno es 404 aunque el archivo sea válido.
      const ticket = await ticketsRepo.findVisibleTicket(db, actor, ticketId);
      if (!ticket) throw ticketNotFound();

      let visibility = options.visibility ?? "public";
      if (options.commentId) {
        const comment = await db
          .selectFrom("helpdesk.ticket_comments")
          .select(["id", "author_id", "visibility"])
          .where("id", "=", options.commentId)
          .where("ticket_id", "=", ticketId)
          .executeTakeFirst();
        if (!comment || (comment.visibility === "internal" && !admin)) throw notFound("No encontramos ese comentario.");
        if (comment.author_id !== actor.id) throw forbidden("Solo quien escribió el comentario puede adjuntarle archivos.");
        if (options.visibility && options.visibility !== comment.visibility)
          throw new AppError(400, "invalid_request", "El adjunto hereda la visibilidad del comentario.");
        visibility = comment.visibility;
      }
      if (visibility === "internal" && !admin) throw forbidden("Solo el equipo de soporte puede adjuntar archivos internos.");
      if (ticket.status === "closed" && visibility === "public")
        throw new AppError(409, "ticket_closed", "El ticket está cerrado. Reábrelo para agregar evidencias.");

      const checked = await check(files, `t/${ticketId}`);
      const ids = await storeThenCommit(checked, () =>
        db.transaction().execute(async (trx) => {
          const locked = await ticketsRepo.findVisibleTicket(trx, actor, ticketId, true);
          if (!locked) throw ticketNotFound();
          const rows = await trx
            .insertInto("helpdesk.attachments")
            .values(
              checked.map((file) => ({
                ticket_id: ticketId,
                conversation_id: null,
                comment_id: options.commentId ?? null,
                message_id: null,
                uploader_id: actor.id,
                visibility,
                original_name: file.name,
                mime_type: file.mime,
                size_bytes: file.buffer.length,
                sha256: file.sha256,
                storage_key: file.key,
                removed_at: null,
                removed_by: null,
                removal_reason: null,
                shared_with_ai_at: null,
              })),
            )
            .returning("id")
            .execute();
          // Un adjunto interno genera un evento interno: el solicitante no ve ni el aviso.
          await recordEvent(trx, {
            ticket: locked,
            type: "attachment_added",
            visibility,
            actorId: actor.id,
            data: { attachment_ids: rows.map((r) => r.id), names: checked.map((f) => f.name), comment_id: options.commentId ?? null },
          });
          return rows.map((r) => r.id);
        }),
      );
      return Promise.all(ids.map(async (id) => (await findListed(db, id))!));
    },

    // Evidencias del chat antes de escalar. Al crear el ticket pasan a él (escalateToTicket).
    async uploadToConversation(actor: Agent, conversationId: string, files: IncomingFile[]) {
      const conversation = await db
        .selectFrom("helpdesk.conversations")
        .select(["id", "status"])
        .where("id", "=", conversationId)
        .where("requester_id", "=", actor.id)
        .executeTakeFirst();
      if (!conversation) throw notFound("No encontramos esta conversación.");
      if (conversation.status === "escalated")
        throw new AppError(409, "conversation_already_escalated", "Esta conversación ya tiene un ticket. Adjunta las evidencias en el ticket.");
      const checked = await check(files, `c/${conversationId}`);
      const rows = await storeThenCommit(checked, () =>
        db
          .insertInto("helpdesk.attachments")
          .values(
            checked.map((file) => ({
              ticket_id: null,
              conversation_id: conversationId,
              comment_id: null,
              message_id: null,
              uploader_id: actor.id,
              visibility: "public" as const,
              original_name: file.name,
              mime_type: file.mime,
              size_bytes: file.buffer.length,
              sha256: file.sha256,
              storage_key: file.key,
              removed_at: null,
              removed_by: null,
              removal_reason: null,
              shared_with_ai_at: null,
            })),
          )
          .returningAll()
          .execute(),
      );
      return rows.map(toChatAttachment);
    },

    // Se verifica el permiso en cada descarga (AC-006.5). Ajeno, interno o retirado → 404.
    async download(actor: Agent, id: string, inline: boolean) {
      const row = await findDownloadable(db, actor, id);
      if (!row) throw attachmentNotFound();
      const { stream, length } = await storage.get(row.storage_key);
      return {
        stream,
        length: length ?? Number(row.size_bytes),
        mime: row.mime_type,
        name: row.original_name,
        // Solo las imágenes se muestran en línea; el resto siempre se descarga.
        inline: inline && isImageMime(row.mime_type),
      };
    },

    // Soft delete (AC-006.7): deja de servirse y queda la traza con autor, fecha y motivo.
    // El binario se conserva para auditoría.
    async remove(admin: Agent, id: string, reason: string): Promise<Attachment> {
      await db.transaction().execute(async (trx) => {
        const row = await trx.selectFrom("helpdesk.attachments").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
        if (!row || !row.ticket_id) throw attachmentNotFound();
        if (row.status === "removed") return;
        const ticket = await ticketsRepo.findVisibleTicket(trx, admin, row.ticket_id, true);
        if (!ticket) throw attachmentNotFound();
        await trx
          .updateTable("helpdesk.attachments")
          .set({ status: "removed", removed_at: sql`now()`, removed_by: admin.id, removal_reason: reason })
          .where("id", "=", id)
          .execute();
        await recordEvent(trx, {
          ticket,
          type: "attachment_removed",
          visibility: row.visibility,
          actorId: admin.id,
          data: { attachment_id: id, name: row.original_name, reason },
        });
      });
      return (await findListed(db, id))!;
    },
  };
}

export type AttachmentService = ReturnType<typeof createAttachmentService>;
