import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "./route-dependencies.js";
import { registerClientProfileRoutes } from "./client-profile-routes.js";
import { registerClientQuoteRoutes } from "./client-quote-routes.js";

export function registerClientContextRoutes(app: FastifyInstance, dependencies: RouteDependencies): void {
  registerClientProfileRoutes(app, dependencies);
  registerClientQuoteRoutes(app, dependencies);
}