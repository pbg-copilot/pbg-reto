import type { Pool } from "pg";
import { withAuthenticatedTransaction } from "../../shared/auth/authorization.js";
import type { AppointmentAvailability } from "./domain/appointment-availability.js";
import { PostgresAppointmentAvailabilityRepository } from "./repositories/appointment-availability-repository.js";
import { AppointmentAvailabilityService } from "./services/appointment-availability-service.js";

export function createAppointmentAvailabilityService(pool: Pool): AppointmentAvailability {
  return new AppointmentAvailabilityService(
    { run: (tokenHash, operation) => withAuthenticatedTransaction(pool, tokenHash, operation) },
    new PostgresAppointmentAvailabilityRepository(),
  );
}
