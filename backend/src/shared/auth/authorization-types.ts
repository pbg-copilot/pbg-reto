import type { Pool, PoolClient } from "pg";

export type Database = Pick<Pool | PoolClient, "query">;

export type AuthorizedClient = {
  document_path: string;
  client_record_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  stage: string | null;
};

export type AuthorizedClientProfile = AuthorizedClient & {
  modified_at: Date | null;
  notes_count: number;
  calls_count: number;
  notes_type: string | null;
  calls_type: string | null;
};

export type Principal = {
  accountId: string;
  role: "agent" | "agency_owner" | "admin";
  agencyId: string | null;
};

export type AuthorizedConversation = {
  id: string;
  owner_account_id: string;
  title: string | null;
  status: "active" | "archived";
  active_client_path: string | null;
  active_client_record_id: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
};

export type AuthorizedAccount = {
  id: string;
  role: string;
  agency_id: string | null;
};

export type AuthorizedAgency = {
  id: string;
  name: string;
  timezone: string | null;
};
