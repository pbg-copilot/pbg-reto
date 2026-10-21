import type { Kysely } from "kysely";
import { displayNumber, type AssistantAction } from "@reto/shared";
import type { AssistantActionRow, DB } from "../../db/types.js";

type Db = Kysely<DB>;
type Row = AssistantActionRow & { number: number };

// Una propuesta vencida se muestra como "expired" aunque nadie la haya tocado todavía.
export function toAssistantAction(row: Row, now = Date.now()): AssistantAction {
  const payload = row.payload as { body?: string; reason?: string };
  const result = (row.result ?? {}) as { error?: string };
  const expired = row.status === "proposed" && new Date(row.expires_at).getTime() < now;
  return {
    id: row.id,
    type: row.type,
    status: expired ? "expired" : row.status,
    ticket: { id: row.ticket_id, display_number: displayNumber(row.number), url: `/tickets/${row.ticket_id}` },
    text: payload.body ?? payload.reason ?? "",
    expires_at: new Date(row.expires_at).toISOString(),
    decided_at: row.decided_at ? new Date(row.decided_at).toISOString() : null,
    error: result.error ?? null,
  };
}

export function actionsQuery(db: Db) {
  return db
    .selectFrom("helpdesk.assistant_actions as x")
    .innerJoin("helpdesk.tickets as t", "t.id", "x.ticket_id")
    .selectAll("x")
    .select("t.number");
}

export async function actionsByMessage(db: Db, messageIds: string[]) {
  const map = new Map<string, AssistantAction[]>();
  if (messageIds.length === 0) return map;
  const rows = await actionsQuery(db).where("x.message_id", "in", messageIds).orderBy("x.proposed_at").execute();
  for (const row of rows) {
    const list = map.get(row.message_id!) ?? [];
    list.push(toAssistantAction(row));
    map.set(row.message_id!, list);
  }
  return map;
}
