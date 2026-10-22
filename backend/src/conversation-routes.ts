import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "./route-dependencies.js";
import { registerConversationManagementRoutes } from "./conversation-management-routes.js";
import { registerClientSearchRoutes } from "./client-search-routes.js";
import { registerClientSelectionRoutes } from "./client-selection-routes.js";
import { registerAppointmentChatStateRoutes } from "./appointment-chat-state-routes.js";

export function registerConversationRoutes(app: FastifyInstance, dependencies: RouteDependencies): void {
  registerConversationManagementRoutes(app, dependencies);
  registerClientSearchRoutes(app, dependencies);
  registerClientSelectionRoutes(app, dependencies);
  registerAppointmentChatStateRoutes(app, dependencies);
}