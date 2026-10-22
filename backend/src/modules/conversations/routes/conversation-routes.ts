import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { registerConversationManagementRoutes } from "./conversation-management-routes.js";
import { registerClientSearchRoutes } from "../../clients/routes/client-search-routes.js";
import { registerClientSelectionRoutes } from "../../clients/routes/client-selection-routes.js";
import { registerAppointmentChatStateRoutes } from "../../appointments/routes/appointment-chat-state-routes.js";

export function registerConversationRoutes(app: FastifyInstance, dependencies: RouteDependencies): void {
  registerConversationManagementRoutes(app, dependencies);
  registerClientSearchRoutes(app, dependencies);
  registerClientSelectionRoutes(app, dependencies);
  registerAppointmentChatStateRoutes(app, dependencies);
}