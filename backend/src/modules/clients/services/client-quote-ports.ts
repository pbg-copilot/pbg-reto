import type { AuthorizedClientProfile, Database, Principal } from "../../../shared/auth/authorization-types.js";

export type ClientQuoteScope = Pick<AuthorizedClientProfile, "document_path" | "client_record_id">;

export type ClientQuoteRow = {
  quote_id: string;
  carrier: string | null;
  product: string | null;
  face_amount_cents: string | null;
  monthly_premium_cents: string | null;
  annual_premium_cents: string | null;
  created_at: Date | string | null;
};

export interface ClientQuoteRepository {
  findProfile(db: Database, principal: Principal, documentPath: string, clientRecordId: string): Promise<AuthorizedClientProfile | null>;
  listQuotes(db: Database, principal: Principal, profile: ClientQuoteScope): Promise<ClientQuoteRow[]>;
}
