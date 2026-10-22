import type { LocalDateTimeError, LocalDateTimeResolution } from "../../../shared/time/timezones.js";

export type AppointmentAvailabilityQuery = {
  agentAccountId: string;
  localStart: string;
  durationMinutes: number;
  timeZone: string;
  utcOffsetMinutes?: number;
};

export type AppointmentAvailabilityConflict = {
  id: string;
  start_at: Date;
  end_at: Date;
};

export type AppointmentAvailabilityOutcome =
  | { state: "agent_not_found" }
  | {
      state: "loaded";
      agentAccountId: string;
      interval: LocalDateTimeResolution;
      conflicts: AppointmentAvailabilityConflict[];
      confirmedCount: number;
    };

export type AuthenticatedAvailabilityResult<T> =
  | { authenticated: false }
  | { authenticated: true; result: T };

export type AppointmentAvailabilityResult =
  | { state: "local_time_error"; error: LocalDateTimeError }
  | AuthenticatedAvailabilityResult<AppointmentAvailabilityOutcome>;

export interface AppointmentAvailability {
  check(tokenHash: string, query: AppointmentAvailabilityQuery): Promise<AppointmentAvailabilityResult>;
}
