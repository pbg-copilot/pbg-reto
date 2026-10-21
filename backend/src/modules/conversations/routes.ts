import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import {
  apiErrorSchema,
  conversationListSchema,
  conversationSchema,
  escalateBodySchema,
  resolutionBodySchema,
  sendMessageBodySchema,
  turnResponseSchema,
} from "@reto/shared";
import { chatRateLimit, mutationRateLimit } from "../../lib/rate-limit.js";
import type { ConversationService } from "./service.js";

const security: Record<string, string[]>[] = [{ bearer: [] }, { cookie: [] }];
const errors = { 400: apiErrorSchema, 401: apiErrorSchema, 403: apiErrorSchema, 404: apiErrorSchema };
const idParams = z.object({ id: z.uuid() });
const idempotencyHeader = z.looseObject({ "idempotency-key": z.string().min(8).max(128) });

const conversationRoutes: FastifyPluginAsyncZod<{ service: ConversationService }> = async (app, { service }) => {
  const tags = ["chat de soporte"];
  const idempotent = { preValidation: app.requireAuth, preHandler: app.idempotent };

  app.post(
    "/support/conversations",
    {
      ...idempotent,
      config: { rateLimit: mutationRateLimit },
      schema: { tags, security, summary: "Nueva conversación", headers: idempotencyHeader, response: { 201: conversationSchema, ...errors } },
    },
    async (request, reply) => reply.code(201).send(await service.create(request.actor!)),
  );

  app.get(
    "/support/conversations",
    {
      preValidation: app.requireAuth,
      schema: { tags, security, summary: "Mis conversaciones recientes", response: { 200: conversationListSchema, ...errors } },
    },
    async (request) => service.list(request.actor!),
  );

  app.get(
    "/support/conversations/:id",
    {
      preValidation: app.requireAuth,
      schema: {
        tags,
        security,
        summary: "Conversación con su historial",
        description: "El dueño la ve completa. Un admin la ve en solo lectura si originó un ticket. Otro usuario: 404.",
        params: idParams,
        response: { 200: conversationSchema, ...errors },
      },
    },
    async (request) => service.get(request.actor!, request.params.id),
  );

  app.post(
    "/support/conversations/:id/messages",
    {
      ...idempotent,
      config: { rateLimit: chatRateLimit },
      schema: {
        tags,
        security,
        summary: "Enviar un mensaje al asistente",
        description:
          "El mensaje se guarda antes de llamar al modelo. Si el modelo falla: 503 assistant_unavailable y el mensaje queda guardado; reintentar con la misma Idempotency-Key no lo duplica.",
        headers: idempotencyHeader,
        params: idParams,
        body: sendMessageBodySchema,
        response: { 200: turnResponseSchema, ...errors, 409: apiErrorSchema, 503: apiErrorSchema },
      },
    },
    async (request) => service.sendMessage(request.actor!, request.params.id, request.body.text, request.idempotency!.key),
  );

  app.post(
    "/support/conversations/:id/resolution",
    {
      ...idempotent,
      config: { rateLimit: chatRateLimit },
      schema: {
        tags,
        security,
        summary: "¿Se resolvió? (Sí / No)",
        description: "Sí: conversación resuelta sin ticket. No: se registra el paso; al segundo fallo se crea el ticket sin pasar por el modelo.",
        headers: idempotencyHeader,
        params: idParams,
        body: resolutionBodySchema,
        response: { 200: turnResponseSchema, ...errors, 409: apiErrorSchema, 503: apiErrorSchema },
      },
    },
    async (request) => service.resolution(request.actor!, request.params.id, request.body),
  );

  app.post(
    "/support/conversations/:id/escalate",
    {
      ...idempotent,
      config: { rateLimit: mutationRateLimit },
      schema: {
        tags,
        security,
        summary: "Hablar con una persona (crear ticket sin IA)",
        description: "Crea el ticket con el contexto de la conversación. También es el formulario alternativo cuando la IA no responde.",
        headers: idempotencyHeader,
        params: idParams,
        body: escalateBodySchema,
        response: { 200: turnResponseSchema, ...errors, 409: apiErrorSchema },
      },
    },
    async (request) => service.escalate(request.actor!, request.params.id, request.body ?? {}),
  );
};

export default conversationRoutes;
