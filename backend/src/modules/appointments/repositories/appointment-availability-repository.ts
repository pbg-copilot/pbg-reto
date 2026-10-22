import type { Database, Principal } from "../../../shared/auth/authorization-types.js";
import type { LocalDateTimeResolution } from "../../../shared/time/timezones.js";
import type { AppointmentAvailabilityConflict } from "../domain/appointment-availability.js";
import type { AppointmentAvailabilityRepository } from "../services/appointment-availability-ports.js";

export class PostgresAppointmentAvailabilityRepository implements AppointmentAvailabilityRepository {
  async canReadAgent(db: Database, principal: Principal, agentAccountId: string) {
    const { rows: agents } = await db.query<{ id: string }>(
      `SELECT id
         FROM onboarding.accounts
        WHERE id = $1
          AND role = 'agent'
          AND status = 'active'
          AND (
            $2 = 'admin'
            OR ($2 = 'agent' AND id = $3)
            OR ($2 = 'agency_owner' AND agency_id = $4)
          )`,
      [
        agentAccountId,
        principal.role,
        principal.accountId,
        principal.agencyId,
      ],
    );
    return agents.length > 0;
  }

  async listConflicts(db: Database, agentAccountId: string, interval: LocalDateTimeResolution) {
    const { rows: conflicts } = await db.query<AppointmentAvailabilityConflict>(
      `SELECT id, start_at, end_at
         FROM reto.chat_appointments
        WHERE agent_account_id = $1
          AND status = 'confirmed'
          AND start_at < $3
          AND end_at > $2
        ORDER BY start_at, id`,
      [agentAccountId, interval.startAt, interval.endAt],
    );
    return conflicts;
  }

  async countConfirmed(db: Database, agentAccountId: string) {
    const { rows: calendarCounts } = await db.query<{ confirmed_count: number }>(
      `SELECT count(*)::int AS confirmed_count
         FROM reto.chat_appointments
        WHERE agent_account_id = $1
          AND status = 'confirmed'`,
      [agentAccountId],
    );
    return calendarCounts[0].confirmed_count;
  }
}
