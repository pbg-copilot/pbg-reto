import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { jsonSchemaTransform } from "fastify-type-provider-zod";

export default fp(async function swaggerPlugin(app) {
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "RETO · Soporte y tickets con IA",
        description:
          "API del reto. Convenciones de errores, paginación, idempotencia y concurrencia en specs/000-overview/api-conventions.md.",
        version: "1.0.0",
      },
      components: {
        securitySchemes: {
          bearer: { type: "http", scheme: "bearer" },
          cookie: { type: "apiKey", in: "cookie", name: "reto_session" },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
});
