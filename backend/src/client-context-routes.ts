import type { FastifyInstance } from "fastify";
import { getAuthorizedClientProfile, withAuthorizedConversationTransaction } from "./authorization.js";
import type { RouteDependencies } from "./route-dependencies.js";

export function registerClientContextRoutes(
  app: FastifyInstance,
  { pool, digest, tokenOf }: RouteDependencies,
): void {
  app.get<{
    Params: { conversationId: string };
    Querystring: {
      limit?: number;
      beforeNoteIndex?: string;
      beforeActivityIndex?: string;
    };
  }>(
    "/api/conversations/:conversationId/client",
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
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
            beforeNoteIndex: {
              type: "string",
              pattern: "^[1-9][0-9]{0,18}$",
            },
            beforeActivityIndex: {
              type: "string",
              pattern: "^[1-9][0-9]{0,18}$",
            },
          },
        },
      },
    },
    async (req, reply) => {
      const limit = req.query.limit ?? 20;
      const beforeNoteIndex = req.query.beforeNoteIndex ?? null;
      const beforeActivityIndex = req.query.beforeActivityIndex ?? null;
      if (
        (beforeNoteIndex !== null &&
          BigInt(beforeNoteIndex) > 9223372036854775807n) ||
        (beforeActivityIndex !== null &&
          BigInt(beforeActivityIndex) > 9223372036854775807n)
      )
        return reply.code(400).send({
          error: "invalid_request",
          message: "El cursor de notas o actividad no es válido.",
        });
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
            `SELECT note.ordinality::text AS note_index,
                    COALESCE(NULLIF(note.value->>'id', ''), note.ordinality::text) AS note_id,
                    NULLIF(note.value->>'callId', '') AS call_id,
                    note.value->'text' AS text,
                    CASE WHEN jsonb_typeof(note.value->'at') = 'number'
                              AND (note.value->>'at')::numeric BETWEEN 0 AND 4102444800000
                      THEN to_timestamp((note.value->>'at')::double precision / 1000.0)
                      ELSE NULL END AS occurred_at
               FROM public.pbg_state_documents AS d
               JOIN onboarding.accounts AS owner
                 ON owner.id = d.document->>'ownerKey'
                AND owner.status = 'active'
                AND owner.role IN ('agent', 'agency_owner')
               CROSS JOIN LATERAL jsonb_array_elements(
                 CASE WHEN jsonb_typeof(d.document->'leads') = 'array'
                   THEN d.document->'leads' ELSE '[]'::jsonb END
               ) AS lead
               CROSS JOIN LATERAL jsonb_array_elements(
                 CASE WHEN jsonb_typeof(lead->'notes') = 'array'
                   THEN lead->'notes' ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS note(value, ordinality)
              WHERE d.path = $1
                AND d.path LIKE 'leads-store/books/%'
                AND jsonb_typeof(d.document) = 'object'
                AND jsonb_typeof(lead) = 'object'
                AND lead->>'id' = $2
                AND jsonb_typeof(note.value) = 'object'
                AND (
                  jsonb_typeof(note.value->'text') = 'string'
                  OR (jsonb_typeof(note.value->'text') = 'object'
                      AND (jsonb_typeof(note.value->'text'->'es') = 'string'
                           OR jsonb_typeof(note.value->'text'->'en') = 'string'))
                )
                AND (
                  $3 = 'admin'
                  OR ($3 = 'agent' AND owner.id = $4)
                  OR ($3 = 'agency_owner' AND owner.role = 'agent'
                      AND owner.agency_id = $5)
                )
                AND ($6::bigint IS NULL OR note.ordinality < $6::bigint)
              ORDER BY note.ordinality DESC
              LIMIT $7`,
            [
              profile.document_path,
              profile.client_record_id,
              principal.role,
              principal.accountId,
              principal.agencyId,
              beforeNoteIndex,
              limit + 1,
            ],
          );
          const activityResult = await client.query(
            `WITH scoped_lead AS (
               SELECT lead
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
             ), eligible AS (
               SELECT note.ordinality,
                      COALESCE(NULLIF(note.value->>'id', ''), note.ordinality::text) AS note_id,
                      note.value->>'callId' AS call_id,
                      CASE WHEN jsonb_typeof(note.value->'at') = 'number'
                                 AND (note.value->>'at')::numeric BETWEEN 0 AND 4102444800000
                        THEN to_timestamp((note.value->>'at')::double precision / 1000.0)
                        ELSE NULL END AS occurred_at
                 FROM scoped_lead
                 CROSS JOIN LATERAL jsonb_array_elements(
                   CASE WHEN jsonb_typeof(lead->'notes') = 'array'
                     THEN lead->'notes' ELSE '[]'::jsonb END
                 ) WITH ORDINALITY AS note(value, ordinality)
                WHERE jsonb_typeof(note.value) = 'object'
                  AND NULLIF(note.value->>'callId', '') IS NOT NULL
                  AND CASE WHEN jsonb_typeof(note.value->'at') = 'number'
                      THEN (note.value->>'at')::numeric BETWEEN 0 AND 4102444800000
                      ELSE false END
             ), page AS (
               SELECT * FROM eligible
                WHERE $6::bigint IS NULL OR ordinality < $6::bigint
                ORDER BY ordinality DESC
                LIMIT $7
             )
             SELECT page.ordinality::text AS activity_index,
                    page.note_id,
                    page.call_id,
                    page.occurred_at,
                    (SELECT count(*) FROM eligible)::integer AS total_count
               FROM (SELECT 1) AS seed
               LEFT JOIN page ON true
              ORDER BY page.ordinality DESC`,
            [
              profile.document_path,
              profile.client_record_id,
              principal.role,
              principal.accountId,
              principal.agencyId,
              beforeActivityIndex,
              limit + 1,
            ],
          );
          const hasMore = rows.length > limit;
          const page = rows.slice(0, limit).reverse();
          const notes = page.map((note) => {
            const rawText = note.text as unknown;
            const text =
              typeof rawText === "string"
                ? { original: rawText.slice(0, 4000), truncated: rawText.length > 4000 }
                : rawText && typeof rawText === "object" && !Array.isArray(rawText)
                  ? {
                      es:
                        typeof (rawText as Record<string, unknown>).es === "string"
                          ? ((rawText as Record<string, string>).es).slice(0, 4000)
                          : null,
                      en:
                        typeof (rawText as Record<string, unknown>).en === "string"
                          ? ((rawText as Record<string, string>).en).slice(0, 4000)
                          : null,
                      truncated:
                        (((rawText as Record<string, unknown>).es as string | undefined)?.length ?? 0) > 4000 ||
                        (((rawText as Record<string, unknown>).en as string | undefined)?.length ?? 0) > 4000,
                    }
                  : { original: null, truncated: false };
            const occurredAt = note.occurred_at as Date | null;
            return {
              id: note.note_id as string,
              index: note.note_index as string,
              call_id: note.call_id as string | null,
              text,
              occurred_at: occurredAt,
              source: {
                type: "client_note",
                document_path: profile.document_path,
                client_record_id: profile.client_record_id,
                note_id: note.note_id,
                note_index: note.note_index,
                date: occurredAt,
              },
            };
          });
          const missing: string[] = [
            ...(["name", "email", "phone", "stage"] as const).filter(
              (field) => profile[field] === null,
            ),
          ];
          if (profile.notes_type === null || profile.notes_count === 0)
            missing.push("notes");
          if (profile.calls_type !== null && profile.calls_type !== "array")
            missing.push("calls: formato no compatible");
          else if (profile.calls_count > 0)
            missing.push("calls: las entradas originales no tienen fecha ni estructura verificables");
          const activityRows = activityResult.rows.filter(
            (entry) => entry.activity_index !== null,
          );
          const activityHasMore = activityRows.length > limit;
          const activityPage = activityRows.slice(0, limit).reverse();
          const activityEntries = activityPage.map((entry) => ({
              type: "call_note",
              call_id: entry.call_id as string,
              note_id: entry.note_id as string,
              occurred_at: entry.occurred_at as Date,
              source: {
                type: "client_note",
                document_path: profile.document_path,
                client_record_id: profile.client_record_id,
                note_id: entry.note_id,
                note_index: entry.activity_index,
                date: entry.occurred_at,
              },
            }));
          const activityCount = Number(activityResult.rows[0]?.total_count ?? 0);
          return {
            state: "loaded" as const,
            profile,
            notes,
            activityEntries,
            activityHasMore,
            nextBeforeActivityIndex: activityHasMore
              ? activityPage[0].activity_index
              : null,
            activityCount,
            hasMore,
            nextBeforeNoteIndex: hasMore ? page[0].note_index : null,
            missing,
          };
        },
      );
      if (!result.authenticated)
        return reply.code(401).send({
          error: "unauthorized",
          message: "Inicia sesión para continuar.",
        });
      if (!result.authorized || result.result.state === "not_found")
        return reply.code(404).send({
          error: "not_found",
          message: "Conversación o cliente no encontrado.",
        });
      if (result.result.state === "client_not_selected")
        return reply.code(409).send({
          error: "client_not_selected",
          message: "Selecciona un cliente antes de consultar su expediente.",
        });
      const {
        profile,
        notes,
        activityEntries,
        activityHasMore,
        nextBeforeActivityIndex,
        activityCount,
        hasMore,
        nextBeforeNoteIndex,
        missing,
      } = result.result;
      return {
        client: {
          id: profile.client_record_id,
          name: profile.name,
          email: profile.email,
          phone: profile.phone,
          stage: profile.stage,
        },
        source: {
          type: "client_record",
          document_path: profile.document_path,
          client_record_id: profile.client_record_id,
          date: profile.modified_at,
        },
        notes,
        notes_status:
          profile.notes_type === null ||
          (profile.notes_type === "array" && profile.notes_count === 0)
            ? "empty"
            : notes.length > 0
              ? "loaded"
              : beforeNoteIndex !== null
                ? "empty"
                : "unavailable",
        notes_pagination: {
          limit,
          hasMore,
          nextBeforeNoteIndex,
        },
        activity: {
          status:
            activityCount > 0
              ? "partial"
              : profile.calls_type === null ||
                  (profile.calls_type === "array" && profile.calls_count === 0)
                ? "empty"
                : "unavailable",
          entries: activityEntries,
          pagination: {
            limit,
            hasMore: activityHasMore,
            nextBeforeActivityIndex,
            total: activityCount,
          },
          reason:
            activityCount === 0 &&
            (profile.calls_type === null ||
              (profile.calls_type === "array" && profile.calls_count === 0))
              ? null
              : "Solo se muestran notas con callId y fecha verificables; las entradas de llamadas originales no se interpretan.",
        },
        missing,
      };
    },
  );
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
