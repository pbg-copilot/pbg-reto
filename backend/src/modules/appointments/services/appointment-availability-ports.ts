import type { PoolClient } from "pg";
import type { Database, Principal } from "../../../shared/auth/authorization-types.js";
import type { LocalDateTimeResolution } from "../../../shared/time/timezones.js";
import type { AppointmentAvailabilityConflict, AuthenticatedAvailabilityResult } from "../domain/appointment-availability.js";

export interface AppointmentAvailabilityTransactions {
  run<T>(tokenHash: string, operation: (client: PoolClient, principal: Principal) => Promise<T>): Promise<AuthenticatedAvailabilityResult<T>>;
}

export interface AppointmentAvailabilityRepository {
  canReadAgent(db: Database, principal: Principal, agentAccountId: string): Promise<boolean>;
  listConflicts(db: Database, agentAccountId: string, interval: LocalDateTimeResolution): Promise<AppointmentAvailabilityConflict[]>;
  countConfirmed(db: Database, agentAccountId: string): Promise<number>;
}
