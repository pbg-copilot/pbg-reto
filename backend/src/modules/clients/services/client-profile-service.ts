import type { AuthorizedConversation, Database, Principal } from "../../../shared/auth/authorization-types.js";
import type { ClientProfilePage, ClientProfileRepository } from "./client-profile-ports.js";

export class ClientProfileService {
  constructor(private readonly repository: ClientProfileRepository) {}

  async load(db: Database, conversation: AuthorizedConversation, principal: Principal, options: ClientProfilePage) {
    if (!conversation.active_client_path || !conversation.active_client_record_id)
      return { state: "client_not_selected" as const };
    const profile = await this.repository.findProfile(
      db, principal, conversation.active_client_path, conversation.active_client_record_id,
    );
    if (!profile) return { state: "not_found" as const };
    const { limit, beforeNoteIndex, beforeActivityIndex } = options;
    const rows = await this.repository.listNotes(db, principal, profile, beforeNoteIndex, limit);
    const activity = await this.repository.listActivity(db, principal, profile, beforeActivityIndex, limit);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    const notes = page.map((note) => {
      const rawText = note.text;
      const text =
        typeof rawText === "string"
          ? { original: rawText.slice(0, 4000), truncated: rawText.length > 4000 }
          : rawText && typeof rawText === "object" && !Array.isArray(rawText)
            ? {
                es:
                  typeof (rawText as Record<string, unknown>).es === "string"
                    ? ((rawText as Record<string, string>).es).slice(0, 4000)
                    : null,
                en:
                  typeof (rawText as Record<string, unknown>).en === "string"
                    ? ((rawText as Record<string, string>).en).slice(0, 4000)
                    : null,
                truncated:
                  (((rawText as Record<string, unknown>).es as string | undefined)?.length ?? 0) > 4000 ||
                  (((rawText as Record<string, unknown>).en as string | undefined)?.length ?? 0) > 4000,
              }
            : { original: null, truncated: false };
      const occurredAt = note.occurred_at;
      return {
        id: note.note_id,
        index: note.note_index,
        call_id: note.call_id,
        text,
        occurred_at: occurredAt,
        source: {
          type: "client_note",
          document_path: profile.document_path,
          client_record_id: profile.client_record_id,
          note_id: note.note_id,
          note_index: note.note_index,
          date: occurredAt,
        },
      };
    });
    const missing: string[] = [
      ...(["name", "email", "phone", "stage"] as const).filter(
        (field) => profile[field] === null,
      ),
    ];
    if (profile.notes_type === null || profile.notes_count === 0)
      missing.push("notes");
    if (profile.calls_type !== null && profile.calls_type !== "array")
      missing.push("calls: formato no compatible");
    else if (profile.calls_count > 0)
      missing.push("calls: las entradas originales no tienen fecha ni estructura verificables");
    const activityRows = activity.filter(
      (entry) => entry.activity_index !== null,
    );
    const activityHasMore = activityRows.length > limit;
    const activityPage = activityRows.slice(0, limit).reverse();
    const activityEntries = activityPage.map((entry) => ({
      type: "call_note",
      call_id: entry.call_id as string,
      note_id: entry.note_id as string,
      occurred_at: entry.occurred_at as Date,
      source: {
        type: "client_note",
        document_path: profile.document_path,
        client_record_id: profile.client_record_id,
        note_id: entry.note_id,
        note_index: entry.activity_index,
        date: entry.occurred_at,
      },
    }));
    const activityCount = Number(activity[0]?.total_count ?? 0);
    return {
      state: "loaded" as const,
      profile,
      notes,
      activityEntries,
      activityHasMore,
      nextBeforeActivityIndex: activityHasMore
        ? activityPage[0].activity_index
        : null,
      activityCount,
      hasMore,
      nextBeforeNoteIndex: hasMore ? page[0].note_index : null,
      missing,
    };
  }
}

export type LoadedClientProfile = Extract<Awaited<ReturnType<ClientProfileService["load"]>>, { state: "loaded" }>;
