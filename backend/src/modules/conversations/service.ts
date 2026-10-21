import type Anthropic from "@anthropic-ai/sdk";
import { sql, type Transaction } from "kysely";
import {
  AI_IMAGE_MAX_BYTES,
  attachmentTypeLabel,
  displayNumber,
  formatBytes,
  isAdmin,
  isImageMime,
  type AttachmentMime,
  type ChatAttachment,
  listTicketsQuerySchema,
  type Agent,
  type ArticleRef,
  type CaseDetails,
  type ChatMessage,
  type Conversation,
  type AssistantAction,
  type ConversationList,
  type ConversationState,
  type PaginationQuery,
  type EscalateBody,
  type ResolutionBody,
  type TicketRef,
  type TicketStatus,
  type TurnResponse,
} from "@reto/shared";
import type { Env } from "../../config/env.js";
import type { Database } from "../../db/kysely.js";
import type { ConversationMessageRow, ConversationRow, DB } from "../../db/types.js";
import { AppError, notFound } from "../../lib/errors.js";
import type { TicketService } from "../tickets/service.js";
import { mentionedTicketNumbers, redactSecrets, sanitizeTicketMentions } from "../assistant/guards.js";
import { runTurn, type NewMessage } from "../assistant/orchestrator.js";
import { AssistantUnavailableError, type AssistantProvider } from "../assistant/provider.js";
import type { EscalationInput, TurnState } from "../assistant/tools.js";
import { attachmentsByMessage, toChatAttachment } from "../attachments/repository.js";
import type { AttachmentStorage } from "../attachments/storage.js";
import { recordEvent } from "../tickets/events.js";
import { actionsByMessage, actionsQuery, toAssistantAction } from "./actions.js";

const conversationNotFound = () => notFound("No encontramos esta conversación.");
const iso = (value: Date | string) => new Date(value).toISOString();

const UNAVAILABLE_TEXT =
  "El asistente no está disponible en este momento. Tu mensaje quedó guardado: puedes reintentar o crear un ticket con lo que ya contaste.";

type Deps = { db: Database; env: Env; provider: AssistantProvider; tickets: TicketService; storage: AttachmentStorage };

// Marcador de una imagen compartida con el asistente (AC-006.12). En la base se guarda solo el
// id; al armar el historial se convierte en un bloque image leído del bucket. Así el historial
// que ve el modelo es siempre el mismo (append-only, requisito del thinking de Haiku 5.5) y el
// binario no se guarda en PostgreSQL.
type ImageMarker = { type: "attachment_image"; attachment_id: string };
const isImageMarker = (block: unknown): block is ImageMarker =>
  typeof block === "object" && block !== null && (block as { type?: unknown }).type === "attachment_image";

export function createConversationService({ db, env, provider, tickets, storage }: Deps) {
  // ---------- Lectura ----------

  async function ticketRefFor(ticketId: string | null): Promise<TicketRef | null> {
    if (!ticketId) return null;
    const row = await db.selectFrom("helpdesk.tickets").select(["id", "number", "title", "status"]).where("id", "=", ticketId).executeTakeFirst();
    return row ? toTicketRef(row) : null;
  }

  async function toState(row: ConversationRow, actor: Agent): Promise<ConversationState> {
    return {
      id: row.id,
      status: row.status,
      title: row.title,
      case_details: row.case_details as CaseDetails,
      ticket: await ticketRefFor(row.ticket_id),
      failed_article_ids: row.failed_article_ids,
      read_only: row.requester_id !== actor.id,
      created_at: iso(row.created_at),
      last_message_at: iso(row.last_message_at),
    };
  }

  // Dueño: lectura y escritura. Admin: solo lectura y solo si la conversación originó un ticket.
  async function findVisible(actor: Agent, id: string, forUpdate?: Transaction<DB>) {
    let query = (forUpdate ?? db).selectFrom("helpdesk.conversations").selectAll().where("id", "=", id);
    if (forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    if (!row) return undefined;
    if (row.requester_id === actor.id) return row;
    if (isAdmin(actor) && row.ticket_id && !forUpdate) return row;
    return undefined;
  }

  async function findOwned(actor: Agent, id: string, trx?: Transaction<DB>) {
    const row = await findVisible(actor, id, trx);
    if (!row || row.requester_id !== actor.id) throw conversationNotFound();
    return row;
  }

  async function visibleMessages(conversationId: string): Promise<ChatMessage[]> {
    const rows = await db
      .selectFrom("helpdesk.conversation_messages")
      .selectAll()
      .where("conversation_id", "=", conversationId)
      .where("visible", "=", true)
      .orderBy("seq")
      .execute();
    const ids = rows.map((row) => row.id);
    const [attachments, actions] = await Promise.all([attachmentsByMessage(db, ids), actionsByMessage(db, ids)]);
    return rows.map((row) => toChatMessage(row, attachments.get(row.id), actions.get(row.id)));
  }

  // Historial para el modelo: append-only, tal cual se guardó (incluye thinking y tool_result).
  async function apiHistory(conversationId: string): Promise<Anthropic.MessageParam[]> {
    const rows = await db
      .selectFrom("helpdesk.conversation_messages")
      .select(["role", "content"])
      .where("conversation_id", "=", conversationId)
      .where("kind", "in", ["message", "tool_result", "resolution_feedback"])
      .orderBy("seq")
      .execute();
    const blocks = rows.flatMap((row) => row.content as unknown[]);
    const images = await loadSharedImages(blocks.filter(isImageMarker).map((marker) => marker.attachment_id));
    return rows.map((row) => ({
      role: row.role,
      content: (row.content as unknown[]).map((block) =>
        isImageMarker(block)
          ? (images.get(block.attachment_id) ?? { type: "text", text: "[La imagen compartida ya no está disponible]" })
          : block,
      ) as Anthropic.ContentBlockParam[],
    }));
  }

  async function loadSharedImages(ids: string[]) {
    const map = new Map<string, Anthropic.ImageBlockParam>();
    if (ids.length === 0) return map;
    const rows = await db
      .selectFrom("helpdesk.attachments")
      .select(["id", "mime_type", "storage_key"])
      .where("id", "in", ids)
      .where("status", "=", "active")
      .execute();
    await Promise.all(
      rows.map(async (row) => {
        try {
          const data = (await storage.getBuffer(row.storage_key)).toString("base64");
          map.set(row.id, { type: "image", source: { type: "base64", media_type: row.mime_type as "image/png", data } });
        } catch {
          // Sin la imagen el turno sigue con el texto de reemplazo.
        }
      }),
    );
    return map;
  }

  // Adjuntos subidos a la conversación que se envían con este mensaje. Un reintento con la misma
  // clave reutiliza los que ya quedaron vinculados a su mensaje.
  async function attachmentsForMessage(actor: Agent, conversationId: string, ids: string[], clientMessageId: string) {
    if (ids.length === 0) return [];
    const rows = await db
      .selectFrom("helpdesk.attachments as f")
      .leftJoin("helpdesk.conversation_messages as m", "m.id", "f.message_id")
      .selectAll("f")
      .where("f.id", "in", ids)
      .where("f.conversation_id", "=", conversationId)
      .where("f.uploader_id", "=", actor.id)
      .where("f.status", "=", "active")
      .where((eb) => eb.or([eb("f.message_id", "is", null), eb("m.client_message_id", "=", clientMessageId)]))
      .execute();
    if (rows.length !== new Set(ids).size)
      throw new AppError(400, "invalid_request", "Uno de los adjuntos no es válido o ya se envió en otro mensaje.");
    return rows;
  }

  // ---------- Escritura ----------

  async function insertMessage(
    executor: Database | Transaction<DB>,
    conversationId: string,
    message: {
      role: "user" | "assistant";
      kind: ConversationMessageRow["kind"];
      content: unknown[];
      text?: string | null;
      visible?: boolean;
      clientMessageId?: string | null;
      articleRefs?: ArticleRef[];
      ticketRef?: TicketRef | null;
      meta?: Record<string, unknown>;
      model?: string | null;
      usage?: Record<string, unknown> | null;
    },
  ) {
    return executor
      .insertInto("helpdesk.conversation_messages")
      .values({
        conversation_id: conversationId,
        role: message.role,
        kind: message.kind,
        content: JSON.stringify(message.content),
        display_text: message.text ?? null,
        visible: message.visible ?? true,
        client_message_id: message.clientMessageId ?? null,
        article_refs: JSON.stringify(message.articleRefs ?? []),
        ticket_ref: message.ticketRef ? JSON.stringify(message.ticketRef) : null,
        meta: JSON.stringify(message.meta ?? {}),
        model: message.model ?? null,
        usage: message.usage ? JSON.stringify(message.usage) : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async function touch(executor: Database | Transaction<DB>, conversationId: string, changes: Partial<{ status: ConversationRow["status"]; title: string }> = {}) {
    await executor
      .updateTable("helpdesk.conversations")
      .set({ ...changes, last_message_at: sql`now()`, updated_at: sql`now()` })
      .where("id", "=", conversationId)
      .execute();
  }

  // Crea el ticket de la conversación (una sola vez). Lo usan la herramienta create_ticket,
  // la escalación por fallos repetidos y el botón "Hablar con una persona" (sin modelo).
  async function escalateToTicket(
    actor: Agent,
    conversationId: string,
    input: EscalationInput & { incidentId?: string | null; note?: string },
  ): Promise<TicketRef> {
    return db.transaction().execute(async (trx) => {
      const conversation = await findOwned(actor, conversationId, trx);
      if (conversation.ticket_id) return (await ticketRefFor(conversation.ticket_id))!;
      const userRows = await trx
        .selectFrom("helpdesk.conversation_messages")
        .select("display_text")
        .where("conversation_id", "=", conversationId)
        .where("role", "=", "user")
        .where("kind", "=", "message")
        .orderBy("seq")
        .execute();
      // Reporte original: el texto literal de la persona (con secretos ya enmascarados).
      const original = [...userRows.map((row) => row.display_text ?? ""), input.note ?? ""].filter(Boolean).join("\n\n");
      const attempted = [
        ...(conversation.attempted_steps as { step: string; result: string }[]),
        ...input.attemptedSteps,
      ];
      const ticket = await tickets.createInTransaction(
        trx,
        actor,
        {
          title: input.title.trim().length >= 3 ? input.title.trim().slice(0, 160) : "Problema reportado en el chat",
          description: original || input.reportedSymptom,
          category: input.category,
          impact: input.impact,
        },
        {
          source: input.reason === "human_requested" ? "human_request" : "assistant",
          conversationId,
          incidentId: input.incidentId ?? null,
          attemptedSteps: attempted,
          aiSummary: {
            reported_symptom: input.reportedSymptom,
            case_details: conversation.case_details,
            reason: input.reason,
            // La IA no confirma causas (§02): siempre null cuando escala el asistente.
            confirmed_cause: null,
          },
        },
      );
      await trx
        .updateTable("helpdesk.conversations")
        .set({ status: "escalated", ticket_id: ticket.id, updated_at: sql`now()` })
        .where("id", "=", conversationId)
        .execute();
      // Las evidencias del chat pasan al ticket en la misma transacción (AC-006.2).
      const moved = await trx
        .updateTable("helpdesk.attachments")
        .set({ ticket_id: ticket.id })
        .where("conversation_id", "=", conversationId)
        .where("ticket_id", "is", null)
        .where("status", "=", "active")
        .returning(["id", "original_name"])
        .execute();
      if (moved.length)
        await recordEvent(trx, {
          ticket,
          type: "attachment_added",
          visibility: "public",
          actorId: actor.id,
          data: { attachment_ids: moved.map((f) => f.id), names: moved.map((f) => f.original_name), source: "chat" },
        });
      return toTicketRef(ticket);
    });
  }

  async function myTickets(actor: Agent, number: number | null, status: TicketStatus | null) {
    const list = await tickets.list(
      actor,
      listTicketsQuerySchema.parse({ q: number ? String(number) : undefined, view: status ?? undefined, page_size: 5 }),
    );
    // Aunque el actor sea admin, el asistente solo consulta los tickets propios.
    return list.items
      .filter((ticket) => ticket.requester.id === actor.id)
      .map((ticket) => ({ display_number: ticket.display_number, title: ticket.title, status: ticket.status, updated_at: ticket.updated_at, url: `/tickets/${ticket.id}` }));
  }

  // Ejecuta un turno del asistente y persiste el resultado. Si el modelo falla, deja un aviso
  // visible y responde 503: el mensaje del usuario ya quedó guardado.
  async function assistantTurn(actor: Agent, conversation: ConversationRow): Promise<{ message: ChatMessage; askResolution: boolean }> {
    const state: TurnState = { articleRefs: [], ticketRef: null, incidents: [], evidence: [], actions: [] };
    const ctx = {
      db,
      actor,
      conversationId: conversation.id,
      failedArticleIds: conversation.failed_article_ids,
      state,
      escalate: (input: EscalationInput) =>
        escalateToTicket(actor, conversation.id, {
          ...input,
          incidentId: state.incidents.find((i) => i.category === input.category || i.category === null)?.id ?? null,
        }),
      myTickets: (number: number | null, status: TicketStatus | null) => myTickets(actor, number, status),
      sessionHours: env.SESSION_TTL_HOURS,
    };
    let output;
    try {
      output = await runTurn({
        provider,
        history: await apiHistory(conversation.id),
        ctx,
        maxIterations: env.AI_MAX_TOOL_ITERATIONS,
        callTimeoutMs: env.AI_TIMEOUT_MS,
      });
    } catch (error) {
      if (!(error instanceof AssistantUnavailableError)) throw error;
      // Si el ticket ya se creó antes de la falla, se confirma igual (lo confirmó el backend).
      if (state.ticketRef) return { message: await saveTicketConfirmation(conversation.id, state.ticketRef), askResolution: false };
      await insertMessage(db, conversation.id, {
        role: "assistant",
        kind: "notice",
        content: [],
        text: UNAVAILABLE_TEXT,
        meta: { notice: "assistant_unavailable", reason: error.reason },
      });
      throw new AppError(503, "assistant_unavailable", UNAVAILABLE_TEXT, { conversation_id: conversation.id, reason: error.reason });
    }

    // El texto visible no puede mencionar tickets que el actor no puede ver.
    const mentioned = mentionedTicketNumbers(output.text);
    const allowed = new Set<number>();
    if (mentioned.length)
      for (const row of await db.selectFrom("helpdesk.tickets").select("number").where("requester_id", "=", actor.id).where("number", "in", mentioned).execute())
        allowed.add(row.number);
    const text = sanitizeTicketMentions(output.text, allowed) || (state.ticketRef ? ticketConfirmation(state.ticketRef) : "¿Puedes contarme un poco más?");

    const saved = await db.transaction().execute(async (trx) => {
      let last: ConversationMessageRow | null = null;
      for (const [index, message] of output.messages.entries()) {
        const final = index === output.messages.length - 1;
        last = await insertMessage(trx, conversation.id, {
          role: message.role,
          kind: message.kind,
          content: message.content as NewMessage["content"],
          visible: final,
          text: final ? text : null,
          articleRefs: final ? state.articleRefs : [],
          ticketRef: final ? state.ticketRef : null,
          model: final ? output.model : null,
          usage: final ? output.usage : null,
          // «Revisé tu cuenta» solo si la herramienta se usó en este turno (AC-009.2).
          meta: final && state.evidence.length ? { evidence: state.evidence } : undefined,
        });
      }
      // Las propuestas del turno quedan en el mensaje que las muestra (tarjeta con Confirmar).
      if (state.actions.length)
        await trx.updateTable("helpdesk.assistant_actions").set({ message_id: last!.id }).where("id", "in", state.actions).execute();
      await touch(trx, conversation.id);
      return last!;
    });
    const actions = (await actionsByMessage(db, [saved.id])).get(saved.id);
    return { message: toChatMessage(saved, [], actions), askResolution: state.articleRefs.length > 0 && !state.ticketRef && !actions?.length };
  }

  async function saveTicketConfirmation(conversationId: string, ticket: TicketRef) {
    const row = await insertMessage(db, conversationId, {
      role: "assistant",
      kind: "message",
      content: [{ type: "text", text: ticketConfirmation(ticket) }],
      text: ticketConfirmation(ticket),
      ticketRef: ticket,
    });
    await touch(db, conversationId);
    return toChatMessage(row);
  }

  async function response(actor: Agent, conversationId: string, userMessage: ChatMessage | null, turn: { message: ChatMessage; askResolution: boolean }): Promise<TurnResponse> {
    const row = await findOwned(actor, conversationId);
    return { user_message: userMessage, assistant_message: turn.message, ask_resolution: turn.askResolution, conversation: await toState(row, actor) };
  }

  const service = {
    async create(actor: Agent): Promise<Conversation> {
      const row = await db.insertInto("helpdesk.conversations").values({ requester_id: actor.id, title: null, ticket_id: null, case_details: "{}", attempted_steps: "[]" }).returningAll().executeTakeFirstOrThrow();
      return { ...(await toState(row, actor)), messages: [] };
    },

    async list(actor: Agent, { page, page_size }: PaginationQuery): Promise<ConversationList> {
      const own = db.selectFrom("helpdesk.conversations").where("requester_id", "=", actor.id);
      const [rows, total] = await Promise.all([
        own.selectAll().orderBy("last_message_at", "desc").orderBy("id").limit(page_size).offset((page - 1) * page_size).execute(),
        own.select((eb) => eb.fn.countAll<string>().as("n")).executeTakeFirstOrThrow(),
      ]);
      return { items: await Promise.all(rows.map((row) => toState(row, actor))), page, page_size, total: Number(total.n) };
    },

    async get(actor: Agent, id: string): Promise<Conversation> {
      const row = await findVisible(actor, id);
      if (!row) throw conversationNotFound();
      return { ...(await toState(row, actor)), messages: await visibleMessages(id) };
    },

    async sendMessage(
      actor: Agent,
      id: string,
      rawText: string,
      clientMessageId: string,
      options: { attachmentIds?: string[]; shareImagesWithAi?: boolean } = {},
    ): Promise<TurnResponse> {
      const conversation = await findOwned(actor, id);
      if (conversation.status === "escalated")
        throw new AppError(409, "conversation_already_escalated", "Esta conversación ya tiene un ticket. Sigue el caso desde el ticket.", {
          ticket: await ticketRefFor(conversation.ticket_id),
        });
      const { text, redacted } = redactSecrets(rawText);
      const files = await attachmentsForMessage(actor, id, options.attachmentIds ?? [], clientMessageId);
      // Visión con consentimiento (AC-006.11/12): solo imágenes de este chat, hasta 5 MB.
      const shared = options.shareImagesWithAi ? files.filter((f) => isImageMime(f.mime_type) && Number(f.size_bytes) <= AI_IMAGE_MAX_BYTES) : [];
      // Sin consentimiento, al modelo solo le llegan los metadatos (AC-006.8).
      const note = files.length
        ? `\n\n[Adjuntos de la persona: ${files
            .map((f) => `${f.original_name} (${attachmentTypeLabel[f.mime_type as AttachmentMime]}, ${formatBytes(Number(f.size_bytes))})`)
            .join("; ")}. ${shared.length ? "Las imágenes compartidas van en este mensaje." : "Su contenido no se comparte con el asistente."}]`
        : "";
      const content = [...shared.map((f): ImageMarker => ({ type: "attachment_image", attachment_id: f.id })), { type: "text", text: text + note }];
      // El mensaje se guarda antes de llamar al modelo. Un reintento con la misma clave lo reutiliza.
      await db
        .insertInto("helpdesk.conversation_messages")
        .values({
          conversation_id: id,
          role: "user",
          kind: "message",
          content: JSON.stringify(content),
          display_text: text,
          visible: true,
          client_message_id: clientMessageId,
          article_refs: "[]",
          ticket_ref: null,
          meta: JSON.stringify(redacted ? { notice: "secret_redacted" } : {}),
          model: null,
          usage: null,
        })
        .onConflict((oc) => oc.columns(["conversation_id", "client_message_id"]).doNothing())
        .execute();
      const userRow = await db.selectFrom("helpdesk.conversation_messages").selectAll().where("conversation_id", "=", id).where("client_message_id", "=", clientMessageId).executeTakeFirstOrThrow();
      if (files.length) {
        await db.updateTable("helpdesk.attachments").set({ message_id: userRow.id }).where("id", "in", files.map((f) => f.id)).execute();
        if (shared.length)
          await db
            .updateTable("helpdesk.attachments")
            .set({ shared_with_ai_at: sql`coalesce(shared_with_ai_at, now())` })
            .where("id", "in", shared.map((f) => f.id))
            .execute();
      }
      const sentFiles = files.map((f) => toChatAttachment({ ...f, shared_with_ai_at: shared.some((s) => s.id === f.id) ? new Date() : f.shared_with_ai_at }));
      await touch(db, id, { status: "active", ...(conversation.title ? {} : { title: text.slice(0, 80) }) });
      const turn = await assistantTurn(actor, { ...conversation, status: "active" });
      return response(actor, id, toChatMessage(userRow, sentFiles), turn);
    },

    // "¿Se resolvió?": Sí cierra la conversación sin ticket; No registra el paso y, al segundo
    // fallo, escala de forma determinista (sin depender del modelo).
    async resolution(actor: Agent, id: string, body: ResolutionBody): Promise<TurnResponse> {
      const conversation = await findOwned(actor, id);
      if (conversation.status === "escalated")
        throw new AppError(409, "conversation_already_escalated", "Esta conversación ya tiene un ticket.", { ticket: await ticketRefFor(conversation.ticket_id) });
      const ref = await findArticleRef(id, body.article_id);
      if (!ref) throw new AppError(400, "invalid_request", "Ese artículo no se sugirió en esta conversación.");

      if (body.resolved) {
        const feedback = await insertMessage(db, id, { role: "user", kind: "resolution_feedback", content: [{ type: "text", text: "Sí, se resolvió." }], text: "Sí, se resolvió." });
        const closing = "¡Excelente! Me alegra que se haya resuelto. La conversación queda guardada por si lo necesitas de nuevo.";
        const assistant = await insertMessage(db, id, { role: "assistant", kind: "message", content: [{ type: "text", text: closing }], text: closing });
        await touch(db, id, { status: "resolved" });
        return response(actor, id, toChatMessage(feedback), { message: toChatMessage(assistant), askResolution: false });
      }

      const feedbackText = `No, la solución del artículo «${ref.title}» no funcionó.`;
      const feedback = await insertMessage(db, id, { role: "user", kind: "resolution_feedback", content: [{ type: "text", text: feedbackText }], text: feedbackText });
      const failed = [...new Set([...conversation.failed_article_ids, ref.article_id])];
      const step = { step: `Seguir el artículo «${ref.title}» (v${ref.version})`, result: "No funcionó según la persona", article_id: ref.article_id, article_version: ref.version };
      await db
        .updateTable("helpdesk.conversations")
        .set({ failed_article_ids: failed, attempted_steps: sql`attempted_steps || ${JSON.stringify([step])}::jsonb`, updated_at: sql`now()` })
        .where("id", "=", id)
        .execute();
      const updated = await findOwned(actor, id);

      if (failed.length >= 2) {
        const firstUser = await firstUserText(id);
        const ticket = await escalateToTicket(actor, id, {
          title: firstUser.slice(0, 120),
          reportedSymptom: firstUser,
          category: await articleCategory(ref.article_id),
          impact: "medium",
          reason: "solution_failed",
          attemptedSteps: [],
        });
        return response(actor, id, toChatMessage(feedback), { message: await saveTicketConfirmation(id, ticket), askResolution: false });
      }
      const turn = await assistantTurn(actor, updated);
      return response(actor, id, toChatMessage(feedback), turn);
    },

    // Confirmar una propuesta del asistente (AC-009.5/6/7). Solo el clic de la persona llega aquí:
    // ninguna herramienta del modelo puede confirmar. Se ejecuta con el servicio de tickets y la
    // sesión del actor (permisos, versión y eventos normales, con via: "assistant").
    async confirmAction(actor: Agent, conversationId: string, actionId: string): Promise<AssistantAction> {
      await findOwned(actor, conversationId);
      const outcome = await db.transaction().execute(async (trx) => {
        const row = await actionsQuery(trx)
          .where("x.id", "=", actionId)
          .where("x.conversation_id", "=", conversationId)
          .where("x.requester_id", "=", actor.id)
          .forUpdate("x")
          .executeTakeFirst();
        if (!row) throw notFound("No encontramos esa propuesta.");
        // Confirmar dos veces devuelve el mismo resultado.
        if (row.status === "confirmed") return { action: toAssistantAction(row) };
        if (row.status !== "proposed") throw new AppError(409, "invalid_transition", "Esta propuesta ya no está disponible (se canceló o no se pudo aplicar).");
        if (new Date(row.expires_at).getTime() < Date.now()) {
          await trx.updateTable("helpdesk.assistant_actions").set({ status: "expired", decided_at: sql`now()` }).where("id", "=", actionId).execute();
          return { error: new AppError(409, "invalid_transition", "La propuesta venció. Pídele al asistente que la prepare de nuevo.") };
        }
        const payload = row.payload as { body?: string; reason?: string };
        const number = displayNumber(row.number);
        try {
          let result: Record<string, unknown>;
          let notice: string;
          if (row.type === "comment_on_ticket") {
            const comment = await tickets.comment(actor, row.ticket_id, { body: payload.body ?? "", visibility: "public", requests_info: false }, { via: "assistant" });
            result = { comment_id: comment.id };
            notice = `Listo: agregué tu comentario a ${number}. El equipo lo verá en el ticket.`;
          } else {
            const current = await db.selectFrom("helpdesk.tickets").select("version").where("id", "=", row.ticket_id).executeTakeFirstOrThrow();
            const ticket = await tickets.reopen(actor, row.ticket_id, { version: current.version, reason: payload.reason ?? "" }, { via: "assistant" });
            result = { version: ticket.version };
            notice = `Listo: reabrí ${number}. El equipo recibe el aviso y el historial se conserva.`;
          }
          const updated = await trx
            .updateTable("helpdesk.assistant_actions")
            .set({ status: "confirmed", decided_at: sql`now()`, result: JSON.stringify(result) })
            .where("id", "=", actionId)
            .returningAll()
            .executeTakeFirstOrThrow();
          await insertMessage(trx, conversationId, { role: "assistant", kind: "notice", content: [], text: notice, meta: { notice: "action_confirmed" } });
          return { action: toAssistantAction({ ...updated, number: row.number }) };
        } catch (error) {
          // El ticket cambió (por ejemplo, se cerró): la propuesta queda fallida y se explica.
          if (!(error instanceof AppError) || error.statusCode >= 500) throw error;
          await trx
            .updateTable("helpdesk.assistant_actions")
            .set({ status: "failed", decided_at: sql`now()`, result: JSON.stringify({ error: error.message }) })
            .where("id", "=", actionId)
            .execute();
          return { error: new AppError(409, "invalid_transition", `No se pudo aplicar: ${error.message}`) };
        }
      });
      if (outcome.error) throw outcome.error;
      return outcome.action!;
    },

    async cancelAction(actor: Agent, conversationId: string, actionId: string): Promise<AssistantAction> {
      await findOwned(actor, conversationId);
      await db
        .updateTable("helpdesk.assistant_actions")
        .set({ status: "cancelled", decided_at: sql`now()` })
        .where("id", "=", actionId)
        .where("conversation_id", "=", conversationId)
        .where("requester_id", "=", actor.id)
        .where("status", "=", "proposed")
        .execute();
      const row = await actionsQuery(db).where("x.id", "=", actionId).where("x.conversation_id", "=", conversationId).where("x.requester_id", "=", actor.id).executeTakeFirst();
      if (!row) throw notFound("No encontramos esa propuesta.");
      return toAssistantAction(row);
    },

    // "Hablar con una persona": crea el ticket con el contexto disponible, sin pasar por el modelo.
    async escalate(actor: Agent, id: string, body: EscalateBody): Promise<TurnResponse> {
      const conversation = await findOwned(actor, id);
      if (conversation.status === "escalated" && conversation.ticket_id)
        throw new AppError(409, "conversation_already_escalated", "Esta conversación ya tiene un ticket.", { ticket: await ticketRefFor(conversation.ticket_id) });
      const firstUser = await firstUserText(id);
      const details = conversation.case_details as CaseDetails;
      if (!firstUser && !body.note) throw new AppError(400, "invalid_request", "Cuéntanos brevemente qué pasa para crear el ticket.");
      const summary = details.observed_error ?? firstUser ?? body.note ?? "";
      const ticket = await escalateToTicket(actor, id, {
        title: (details.area ? `${details.area}: ` : "") + (firstUser || body.note || "Solicitud de ayuda").slice(0, 110),
        reportedSymptom: summary,
        category: "other",
        impact: "medium",
        reason: "human_requested",
        attemptedSteps: [],
        note: body.note,
      });
      return response(actor, id, null, { message: await saveTicketConfirmation(id, ticket), askResolution: false });
    },
  };

  async function findArticleRef(conversationId: string, articleId: string): Promise<ArticleRef | undefined> {
    const rows = await db.selectFrom("helpdesk.conversation_messages").select("article_refs").where("conversation_id", "=", conversationId).where("visible", "=", true).execute();
    return rows.flatMap((row) => row.article_refs as ArticleRef[]).find((ref) => ref.article_id === articleId);
  }

  async function firstUserText(conversationId: string) {
    const row = await db
      .selectFrom("helpdesk.conversation_messages")
      .select("display_text")
      .where("conversation_id", "=", conversationId)
      .where("role", "=", "user")
      .where("kind", "=", "message")
      .orderBy("seq")
      .executeTakeFirst();
    return row?.display_text ?? "";
  }

  async function articleCategory(articleId: string) {
    const row = await db.selectFrom("helpdesk.articles").select("category_code").where("id", "=", articleId).executeTakeFirst();
    return row?.category_code ?? "other";
  }

  return service;
}

export function toTicketRef(row: { id: string; number: number; title: string; status: TicketStatus }): TicketRef {
  return { id: row.id, number: row.number, display_number: displayNumber(row.number), title: row.title, status: row.status, url: `/tickets/${row.id}` };
}

export const ticketConfirmation = (ticket: TicketRef) =>
  `Creé el ticket ${ticket.display_number} para que una persona del equipo de soporte lo revise. Te avisaremos de cada avance; puedes seguirlo en «Mis tickets».`;

function toChatMessage(row: ConversationMessageRow, attachments: ChatAttachment[] = [], actions: AssistantAction[] = []): ChatMessage {
  const meta = row.meta as { notice?: ChatMessage["notice"]; evidence?: ChatMessage["evidence"] };
  return {
    id: row.id,
    role: row.role,
    kind: row.kind === "tool_result" ? "message" : row.kind,
    text: row.display_text ?? "",
    article_refs: row.article_refs as ArticleRef[],
    ticket_ref: (row.ticket_ref as TicketRef | null) ?? null,
    notice: meta.notice ?? null,
    evidence: meta.evidence ?? [],
    attachments,
    actions,
    created_at: iso(row.created_at),
  };
}

export type ConversationService = ReturnType<typeof createConversationService>;
