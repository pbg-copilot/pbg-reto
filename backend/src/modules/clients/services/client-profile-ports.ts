import type { AuthorizedClientProfile, Database, Principal } from "../../../shared/auth/authorization-types.js";

export type ClientProfilePage = {
  limit: number;
  beforeNoteIndex: string | null;
  beforeActivityIndex: string | null;
};

export type ClientProfileScope = Pick<AuthorizedClientProfile, "document_path" | "client_record_id">;

export type ClientNoteRow = {
  note_index: string;
  note_id: string;
  call_id: string | null;
  text: unknown;
  occurred_at: Date | null;
};

export type ClientActivityRow = {
  activity_index: string | null;
  note_id: string | null;
  call_id: string | null;
  occurred_at: Date | null;
  total_count: number;
};

export interface ClientProfileRepository {
  findProfile(db: Database, principal: Principal, documentPath: string, clientRecordId: string): Promise<AuthorizedClientProfile | null>;
  listNotes(db: Database, principal: Principal, profile: ClientProfileScope, beforeNoteIndex: string | null, limit: number): Promise<ClientNoteRow[]>;
  listActivity(db: Database, principal: Principal, profile: ClientProfileScope, beforeActivityIndex: string | null, limit: number): Promise<ClientActivityRow[]>;
}
