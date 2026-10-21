import fp from "fastify-plugin";

type Options = { allowedOrigins: string[] };

// Mismo comportamiento que el repo base, pero con una lista de orígenes permitidos.
export default fp<Options>(async function securityPlugin(app, { allowedOrigins }) {
  const allowed = new Set(allowedOrigins);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
    const origin = request.headers.origin;
    if (origin && !allowed.has(origin))
      return reply
        .code(403)
        .send({ error: "origin_not_allowed", message: "Origen no permitido." });
  });
});
