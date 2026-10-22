import type { PoolClient } from "pg";
import type { Database, Principal } from "../../../shared/auth/authorization-types.js";
import type { AppointmentChatScope } from "../domain/appointment-chat.js";
import type { AppointmentChatStateRow } from "../domain/appointment-chat-state.js";

export interface AppointmentChatStateAccess {
  hasClient(client: PoolClient, principal: Principal, clientPath: string, clientRecordId: string): Promise<boolean>;
  canManageAgent(client: PoolClient, principal: Principal, agentAccountId: string): Promise<boolean>;
}

export interface AppointmentChatStateRepository {
  findPending(db: Database, scope: AppointmentChatScope): Promise<AppointmentChatStateRow | undefined>;
  clearStale(db: Database, scope: AppointmentChatScope): Promise<void>;
}
