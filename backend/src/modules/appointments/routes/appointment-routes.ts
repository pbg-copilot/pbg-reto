import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { registerAppointmentAvailabilityRoutes } from "./appointment-availability-routes.js";
import { registerAppointmentQueryRoutes } from "./appointment-query-routes.js";
import { registerAppointmentConfirmationRoutes } from "./appointment-confirmation-routes.js";
import { registerAppointmentExecutionRoutes } from "./appointment-execution-routes.js";

export function registerAppointmentRoutes(app: FastifyInstance, dependencies: RouteDependencies) {
  registerAppointmentAvailabilityRoutes(app, dependencies);
  registerAppointmentQueryRoutes(app, dependencies);
  registerAppointmentConfirmationRoutes(app, dependencies);
  registerAppointmentExecutionRoutes(app, dependencies);
}