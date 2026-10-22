import type { FastifyInstance } from "fastify";
import type { RouteDependencies } from "../../../shared/http/route-dependencies.js";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "../../../shared/auth/authorization.js";

export function registerClientQuoteRoutes(app: FastifyInstance, { pool, digest, tokenOf }: RouteDependencies): void {
  app.get<{ Params: { conversationId: string } }>(
    "/api/conversations/:conversationId/quotes",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["conversationId"],
          properties: {
            conversationId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (req, reply) => {
      const result = await withAuthorizedConversationTransaction(
        pool,
        digest(tokenOf(req)),
        req.params.conversationId,
        async (client, conversation, principal) => {
          if (!conversation.active_client_path || !conversation.active_client_record_id)
            return { state: "client_not_selected" as const };
          const profile = await getAuthorizedClientProfile(
            client,
            principal,
            conversation.active_client_path,
            conversation.active_client_record_id,
          );
          if (!profile) return { state: "not_found" as const };
          const { rows } = await client.query(
            `WITH scoped_lead AS (
               SELECT owner.id AS owner_id, lead->>'id' AS client_record_id,
                      count(*) OVER () AS matching_lead_count
                 FROM public.pbg_state_documents AS d
                 JOIN onboarding.accounts AS owner
                   ON owner.id = d.document->>'ownerKey'
                  AND owner.status = 'active'
                  AND owner.role IN ('agent', 'agency_owner')
                 CROSS JOIN LATERAL jsonb_array_elements(
                   CASE WHEN jsonb_typeof(d.document->'leads') = 'array'
                     THEN d.document->'leads' ELSE '[]'::jsonb END
                 ) AS lead
                WHERE d.path = $1
                  AND d.path LIKE 'leads-store/books/%'
                  AND jsonb_typeof(d.document) = 'object'
                  AND jsonb_typeof(lead) = 'object'
                  AND lead->>'id' = $2
                  AND (
                    $3 = 'admin'
                    OR ($3 = 'agent' AND owner.id = $4)
                    OR ($3 = 'agency_owner' AND owner.role = 'agent'
                        AND owner.agency_id = $5)
                  )
             )
             SELECT q.quote_id, q.carrier, q.product,
                    q.face_amount_cents, q.monthly_premium_cents,
                    q.annual_premium_cents, q.created_at
               FROM scoped_lead AS lead
               JOIN analytics.quotes AS q
                 ON q.lead_id = lead.client_record_id
                AND q.account_id = lead.owner_id
              WHERE lead.matching_lead_count = 1
              ORDER BY q.created_at NULLS LAST, q.quote_id`,
            [
              profile.document_path,
              profile.client_record_id,
              principal.role,
              principal.accountId,
              principal.agencyId,
            ],
          );
          const quotes = rows.map((quote) => ({
            id: quote.quote_id as string,
            carrier: quote.carrier as string | null,
            product: quote.product as string | null,
            face_amount_cents: quote.face_amount_cents as string | null,
            monthly_premium_cents: quote.monthly_premium_cents as string | null,
            annual_premium_cents: quote.annual_premium_cents as string | null,
            recorded_at: quote.created_at as string | null,
            source: {
              type: "analytics_quote_snapshot",
              table: "analytics.quotes",
              record_id: quote.quote_id,
              client_record_id: profile.client_record_id,
              date: quote.created_at,
              match_basis: "exact_lead_id_and_owner_account_id",
            },
          }));
          const missing = [
            ...(!quotes.length
              ? ["no hay registros con coincidencia exacta de lead_id y account_id"]
              : []),
            "reglas versionadas de elegibilidad, cobertura y tarifas",
            "confirmación de vigencia y aprobación de los importes analíticos",
          ];
          for (const quote of quotes) {
            if (!quote.carrier) missing.push(`cotización ${quote.id}: carrier`);
            if (!quote.product) missing.push(`cotización ${quote.id}: product`);
            if (quote.face_amount_cents === null)
              missing.push(`cotización ${quote.id}: face_amount_cents`);
            if (quote.monthly_premium_cents === null)
              missing.push(`cotización ${quote.id}: monthly_premium_cents`);
            if (quote.annual_premium_cents === null)
              missing.push(`cotización ${quote.id}: annual_premium_cents`);
          }
          return {
            state: "loaded" as const,
            clientRecordId: conversation.active_client_record_id,
            quotes,
            missing,
          };
        },
      );
      if (!result.authenticated)
        return reply.code(401).send({
          error: "unauthorized",
          message: "Inicia sesión para continuar.",
        });
      if (!result.authorized)
        return reply.code(404).send({
          error: "not_found",
          message: "Conversación no encontrada.",
        });
      if (result.result.state === "not_found")
        return reply.code(404).send({
          error: "not_found",
          message: "Conversación o cliente no encontrado.",
        });
      if (result.result.state === "client_not_selected")
        return reply.code(409).send({
          error: "client_not_selected",
          message: "Selecciona un cliente antes de consultar sus cotizaciones.",
        });
      return {
        client_record_id: result.result.clientRecordId,
        quotes_status: result.result.quotes.length ? "loaded" : "empty",
        quotes: result.result.quotes,
        comparison_status:
          result.result.quotes.length > 1
            ? "observed_fields_only"
            : result.result.quotes.length === 1
              ? "single_record"
              : "empty",
        comparison: {
          quote_ids: result.result.quotes.map((quote) => quote.id),
          records: result.result.quotes.map((quote) => ({
            quote_id: quote.id,
            carrier: quote.carrier,
            product: quote.product,
            face_amount_cents: quote.face_amount_cents,
            monthly_premium_cents: quote.monthly_premium_cents,
            annual_premium_cents: quote.annual_premium_cents,
            recorded_at: quote.recorded_at,
            source_record_id: quote.source.record_id,
          })),
          fields: [
            "carrier",
            "product",
            "face_amount_cents",
            "monthly_premium_cents",
            "annual_premium_cents",
            "recorded_at",
          ],
          interpretation: "stored_values_only",
        },
        rules: {
          status: "unavailable",
          version: null,
          reason: "No se encontró un catálogo de reglas versionado en el respaldo.",
        },
        record_semantics: {
          kind: "analytics_snapshot",
          meaning:
            "Valores registrados en analytics.quotes asociados por coincidencia exacta de IDs; no representan por sí solos una oferta vigente, aprobada o emitida.",
          fields: {
            face_amount_cents:
              "Valor nominal almacenado; no confirma cobertura contratada.",
            monthly_premium_cents:
              "Importe mensual almacenado; no confirma tarifa vigente.",
            annual_premium_cents:
              "Importe anual almacenado; no confirma tarifa vigente.",
            recorded_at:
              "Fecha de registro analítico; no es fecha de emisión o vigencia.",
          },
        },
        source: {
          table: "analytics.quotes",
          relationship_status: "exact_key_match_association_only",
        },
        missing: result.result.missing,
      };
    },
  );
}
