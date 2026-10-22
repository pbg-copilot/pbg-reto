import type { PoolClient } from "pg";
import type { AuthorizedClientProfile, Database, Principal } from "../../../shared/auth/authorization-types.js";
import type { ConversationManagementTransactions } from "../../conversations/services/conversation-management-ports.js";
import type { AppointmentRow } from "../domain/appointment-model.js";

export type AppointmentQueryTransactions = Pick<ConversationManagementTransactions, "authorized">;

export interface AppointmentQueryAccess {
  getProfile(client: PoolClient, principal: Principal, clientPath: string, clientRecordId: string): Promise<AuthorizedClientProfile | null>;
  canReadAgent(client: PoolClient, principal: Principal, agentAccountId: string): Promise<boolean>;
}

export interface AppointmentQueryRepository {
  listConfirmed(db: Database, clientPath: string, clientRecordId: string): Promise<AppointmentRow[]>;
}
