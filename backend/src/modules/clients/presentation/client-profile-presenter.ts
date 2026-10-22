import type { ClientProfilePage } from "../services/client-profile-ports.js";
import type { LoadedClientProfile } from "../services/client-profile-service.js";

export function presentClientProfile(result: LoadedClientProfile, { limit, beforeNoteIndex }: ClientProfilePage) {
  const {
    profile,
    notes,
    activityEntries,
    activityHasMore,
    nextBeforeActivityIndex,
    activityCount,
    hasMore,
    nextBeforeNoteIndex,
    missing,
  } = result;
  return {
    client: {
      id: profile.client_record_id,
      name: profile.name,
      email: profile.email,
      phone: profile.phone,
      stage: profile.stage,
    },
    source: {
      type: "client_record",
      document_path: profile.document_path,
      client_record_id: profile.client_record_id,
      date: profile.modified_at,
    },
    notes,
    notes_status:
      profile.notes_type === null ||
      (profile.notes_type === "array" && profile.notes_count === 0)
        ? "empty"
        : notes.length > 0
          ? "loaded"
          : beforeNoteIndex !== null
            ? "empty"
            : "unavailable",
    notes_pagination: {
      limit,
      hasMore,
      nextBeforeNoteIndex,
    },
    activity: {
      status:
        activityCount > 0
          ? "partial"
          : profile.calls_type === null ||
              (profile.calls_type === "array" && profile.calls_count === 0)
            ? "empty"
            : "unavailable",
      entries: activityEntries,
      pagination: {
        limit,
        hasMore: activityHasMore,
        nextBeforeActivityIndex,
        total: activityCount,
      },
      reason:
        activityCount === 0 &&
        (profile.calls_type === null ||
          (profile.calls_type === "array" && profile.calls_count === 0))
          ? null
          : "Solo se muestran notas con callId y fecha verificables; las entradas de llamadas originales no se interpretan.",
    },
    missing,
  };
}
