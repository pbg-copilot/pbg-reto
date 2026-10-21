import { isAdmin, type Agent, type Attachment, type AttachmentMime, type ChatAttachment } from "@reto/shared";
import type { Kysely } from "kysely";
import type { AttachmentRow, DB } from "../../db/types.js";

type Db = Kysely<DB>;

export const downloadPath = (id: string) => `/attachments/${id}/download`;

type ListedRow = AttachmentRow & { uploader_name: string; remover_name: string | null };

export function toAttachment(row: ListedRow): Attachment {
  const removed = row.status === "removed";
  return {
    id: row.id,
    original_name: row.original_name,
    mime_type: row.mime_type as AttachmentMime,
    size_bytes: Number(row.size_bytes),
    visibility: row.visibility,
    comment_id: row.comment_id,
    source: row.conversation_id && !row.comment_id ? "chat" : "ticket",
    uploader: { id: row.uploader_id, name: row.uploader_name },
    created_at: row.created_at.toISOString(),
    status: row.status,
    removal: removed ? { by: row.remover_name ?? "Equipo de soporte", at: row.removed_at!.toISOString(), reason: row.removal_reason ?? "" } : null,
    download_url: removed ? null : downloadPath(row.id),
  };
}

function listed(db: Db) {
  return db
    .selectFrom("helpdesk.attachments as f")
    .innerJoin("reto.agents as u", "u.id", "f.uploader_id")
    .leftJoin("reto.agents as r", "r.id", "f.removed_by")
    .selectAll("f")
    .select(["u.name as uploader_name", "r.name as remover_name"]);
}

// Adjuntos del ticket que el actor puede ver. Los internos se filtran en el SQL (D4): el
// solicitante no los recibe ni retirados. Se incluyen los retirados para mostrar la traza.
export async function listTicketAttachments(db: Db, actor: Agent, ticketId: string): Promise<Attachment[]> {
  let query = listed(db).where("f.ticket_id", "=", ticketId);
  if (!isAdmin(actor)) query = query.where("f.visibility", "=", "public");
  // Los de una misma subida comparten created_at: el nombre da un orden estable.
  const rows = await query.orderBy("f.created_at").orderBy("f.original_name").orderBy("f.id").execute();
  return rows.map(toAttachment);
}

export async function findListed(db: Db, id: string) {
  const row = await listed(db).where("f.id", "=", id).executeTakeFirst();
  return row ? toAttachment(row) : undefined;
}

// Un adjunto se puede descargar si está activo y el actor tiene acceso. Para el solicitante:
// los públicos de sus tickets y los de sus conversaciones. Ajeno o interno → no existe (404).
export async function findDownloadable(db: Db, actor: Agent, id: string) {
  let query = db
    .selectFrom("helpdesk.attachments as f")
    .leftJoin("helpdesk.tickets as t", "t.id", "f.ticket_id")
    .leftJoin("helpdesk.conversations as c", "c.id", "f.conversation_id")
    .select(["f.id", "f.original_name", "f.mime_type", "f.size_bytes", "f.storage_key"])
    .where("f.id", "=", id)
    .where("f.status", "=", "active");
  if (!isAdmin(actor))
    query = query.where((eb) =>
      eb.or([
        eb.and([eb("t.requester_id", "=", actor.id), eb("f.visibility", "=", "public")]),
        eb.and([eb("f.ticket_id", "is", null), eb("c.requester_id", "=", actor.id)]),
      ]),
    );
  return query.executeTakeFirst();
}

export function toChatAttachment(row: Pick<AttachmentRow, "id" | "original_name" | "mime_type" | "size_bytes" | "shared_with_ai_at">): ChatAttachment {
  return {
    id: row.id,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size_bytes: Number(row.size_bytes),
    shared_with_ai: row.shared_with_ai_at !== null,
    download_url: downloadPath(row.id),
  };
}

// Adjuntos de los mensajes del chat, agrupados por mensaje.
export async function attachmentsByMessage(db: Db, messageIds: string[]) {
  const map = new Map<string, ChatAttachment[]>();
  if (messageIds.length === 0) return map;
  const rows = await db
    .selectFrom("helpdesk.attachments")
    .select(["id", "message_id", "original_name", "mime_type", "size_bytes", "shared_with_ai_at"])
    .where("message_id", "in", messageIds)
    .where("status", "=", "active")
    .orderBy("created_at")
    .execute();
  for (const row of rows) {
    const list = map.get(row.message_id!) ?? [];
    list.push(toChatAttachment(row));
    map.set(row.message_id!, list);
  }
  return map;
}
