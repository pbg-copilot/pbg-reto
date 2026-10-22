import { LocalDateTimeError, resolveLocalDateTime, type LocalDateTimeResolution } from "../../../shared/time/timezones.js";
import type { AppointmentAvailability, AppointmentAvailabilityOutcome, AppointmentAvailabilityQuery, AppointmentAvailabilityResult } from "../domain/appointment-availability.js";
import type { AppointmentAvailabilityRepository, AppointmentAvailabilityTransactions } from "./appointment-availability-ports.js";

export class AppointmentAvailabilityService implements AppointmentAvailability {
  constructor(
    private readonly transactions: AppointmentAvailabilityTransactions,
    private readonly repository: AppointmentAvailabilityRepository,
  ) {}

  async check(tokenHash: string, query: AppointmentAvailabilityQuery): Promise<AppointmentAvailabilityResult> {
    let interval: LocalDateTimeResolution;
    try {
      interval = resolveLocalDateTime(query.localStart, query.timeZone, query.durationMinutes, query.utcOffsetMinutes);
    } catch (error) {
      if (!(error instanceof LocalDateTimeError)) throw error;
      return { state: "local_time_error", error };
    }

    return this.transactions.run<AppointmentAvailabilityOutcome>(tokenHash, async (client, principal) => {
      if (!await this.repository.canReadAgent(client, principal, query.agentAccountId))
        return { state: "agent_not_found" };
      const conflicts = await this.repository.listConflicts(client, query.agentAccountId, interval);
      const confirmedCount = await this.repository.countConfirmed(client, query.agentAccountId);
      return { state: "loaded", agentAccountId: query.agentAccountId, interval, conflicts, confirmedCount };
    });
  }
}
