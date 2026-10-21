import { createHash } from "node:crypto";
import fp from "fastify-plugin";
import type { preHandlerAsyncHookHandler } from "fastify";
import { sql } from "kysely";
import { AppError, unauthorized } from "../lib/errors.js";
import type { Database } from "../db/kysely.js";

declare module "fastify" {
  interface FastifyRequest {
    idempotency: { key: string; replayed: boolean } | null;
  }
  interface FastifyInstance {
    // Se usa después de requireAuth: preHandler: [app.requireAuth, app.idempotent]
    idempotent: preHandlerAsyncHookHandler;
  }
}

const KEY = /^[A-Za-z0-9_-]{8,128}$/;
// Una solicitud que quedó "en curso" más de este tiempo se considera abandonada.
const STALE_SECONDS = 120;

export default fp<{ db: Database }>(async function idempotencyPlugin(app, { db }) {
  app.decorateRequest("idempotency", null);

  const idempotent: preHandlerAsyncHookHandler = async (request, reply) => {
    const actor = request.actor;
    if (!actor) throw unauthorized();
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !KEY.test(key))
      throw new AppError(
        400,
        "invalid_request",
        "Falta el encabezado Idempotency-Key o no es válido.",
      );
    const path = request.routeOptions.url ?? request.url;
    const requestHash = createHash("sha256")
      .update(JSON.stringify([request.method, path, request.params, request.body ?? null]))
      .digest("hex");

    const claimed = await sql<{ key: string }>`
      INSERT INTO helpdesk.idempotency_keys (account_id, key, method, path, request_hash, status)
      VALUES (${actor.id}, ${key}, ${request.method}, ${path}, ${requestHash}, 'in_progress')
      ON CONFLICT (account_id, key) DO UPDATE
        SET method = excluded.method, path = excluded.path, request_hash = excluded.request_hash,
            status = 'in_progress', response_status = NULL, response_body = NULL,
            created_at = now(), expires_at = now() + interval '24 hours'
        WHERE helpdesk.idempotency_keys.expires_at < now()
           OR (helpdesk.idempotency_keys.status = 'in_progress'
               AND helpdesk.idempotency_keys.created_at < now() - make_interval(secs => ${STALE_SECONDS}))
      RETURNING key
    `.execute(db);
    if (claimed.rows.length > 0) {
      request.idempotency = { key, replayed: false };
      return;
    }

    const existing = await db
      .selectFrom("helpdesk.idempotency_keys")
      .select(["request_hash", "status", "response_status", "response_body"])
      .where("account_id", "=", actor.id)
      .where("key", "=", key)
      .executeTakeFirst();
    if (!existing || existing.request_hash !== requestHash)
      throw new AppError(
        422,
        "idempotency_key_reused",
        "Esta clave de idempotencia ya se usó con otra solicitud.",
      );
    if (existing.status === "in_progress")
      throw new AppError(
        409,
        "idempotency_in_progress",
        "Tu solicitud anterior todavía se está procesando.",
      );
    request.idempotency = { key, replayed: true };
    // Ya está serializada: se envía como texto para no pasar de nuevo por zod.
    return reply
      .code(existing.response_status ?? 200)
      .header("Idempotent-Replayed", "true")
      .type("application/json; charset=utf-8")
      .send(JSON.stringify(existing.response_body ?? null));
  };

  app.decorate("idempotent", idempotent);

  // Guarda la respuesta final. Los 5xx no se guardan: el cliente puede reintentar.
  app.addHook("onSend", async (request, reply, payload) => {
    const state = request.idempotency;
    if (!state || state.replayed || !request.actor) return payload;
    try {
      if (reply.statusCode >= 500) {
        await db
          .deleteFrom("helpdesk.idempotency_keys")
          .where("account_id", "=", request.actor.id)
          .where("key", "=", state.key)
          .execute();
      } else {
        let body: unknown = null;
        if (typeof payload === "string" && payload.length > 0) {
          try {
            body = JSON.parse(payload);
          } catch {
            body = null;
          }
        }
        await db
          .updateTable("helpdesk.idempotency_keys")
          .set({
            status: "completed",
            response_status: reply.statusCode,
            response_body: JSON.stringify(body),
          })
          .where("account_id", "=", request.actor.id)
          .where("key", "=", state.key)
          .execute();
      }
    } catch (err) {
      request.log.error({ err: { type: (err as Error).name } }, "idempotency store failed");
    }
    return payload;
  });
});
