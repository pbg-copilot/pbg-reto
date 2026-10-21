import type Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../../config/env.js";
import { unwrapUntrusted } from "./guards.js";
import { AssistantUnavailableError, type AssistantProvider, type ProviderResponse } from "./provider.js";

// Proveedor determinista para tests y para la demo sin API key. Recorre el mismo camino que el
// real (emite tool_use y procesa tool_result), así que la lógica del servidor se prueba completa.
//
// Reglas: "[[fail]]" o AI_FAKE_FAILURE → caída del proveedor · "[[inject]]" → intenta leer un
// ticket ajeno · "revisa mi cuenta" → diagnóstico · "agrega a mi ticket N: …" / "reabre N …" →
// propuestas con confirmación · "persona"/"humano" → ticket
// human_requested · si no: datos del caso + búsqueda →
// artículo con pasos, o una pregunta y después ticket no_article / solution_failed.

type Block = Anthropic.ContentBlock;
type Param = Anthropic.MessageParam;

const textOf = (message: Param) =>
  typeof message.content === "string"
    ? message.content
    : message.content
        .filter((block): block is Anthropic.TextBlockParam => block.type === "text")
        .map((block) => block.text)
        .join("\n");

const isToolResultMessage = (message: Param) =>
  Array.isArray(message.content) && message.content.some((block) => block.type === "tool_result");

const textBlock = (text: string) => ({ type: "text", text, citations: null }) as unknown as Block;

export function createFakeProvider(env: Env): AssistantProvider {
  let counter = 0;
  const toolUse = (name: string, input: Record<string, unknown>) =>
    ({ type: "tool_use", id: `toolu_fake_${Date.now()}_${counter++}`, name, input }) as unknown as Block;
  const reply = (content: Block[]): ProviderResponse => ({
    content,
    stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
    model: "fake-assistant",
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  });

  return {
    name: "fake",
    async complete({ messages }) {
      if (env.AI_FAKE_FAILURE) throw new AssistantUnavailableError("provider_error", "AI_FAKE_FAILURE");
      const userTexts = messages.filter((m) => m.role === "user" && !isToolResultMessage(m)).map(textOf);
      const lastText = userTexts.at(-1) ?? "";
      const last = messages.at(-1)!;

      if (!isToolResultMessage(last)) {
        if (lastText.includes("[[fail]]")) throw new AssistantUnavailableError("provider_error", "[[fail]]");
        if (lastText.includes("[[inject]]"))
          // Intenta leer un ticket que no es de la persona: el servidor solo devuelve los propios.
          return reply([toolUse("get_my_tickets", { number: 1, status: null })]);
        if (/revis\w*\s+(el estado de\s+)?mi cuenta|estado de mi cuenta/i.test(lastText)) return reply([toolUse("get_my_account_status", {})]);
        const addTo = /agreg\w*\s+(?:a|en)\s+mi ticket\s+(?:tck-)?0*(\d+)\s*[:,-]?\s*(.+)/is.exec(lastText);
        if (addTo) return reply([toolUse("propose_comment_on_my_ticket", { number: Number(addTo[1]), body: addTo[2]!.trim() })]);
        const reopen = /reabr\w*\s+(?:mi ticket\s+)?(?:tck-)?0*(\d+)\s*[:,-]?\s*(.*)/is.exec(lastText);
        if (reopen) return reply([toolUse("propose_reopen_my_ticket", { number: Number(reopen[1]), reason: reopen[2]!.trim() || "El problema volvió." })]);
        if (/\b(persona|humano|humana)\b/i.test(lastText))
          return reply([
            toolUse("create_ticket", {
              title: lastText.slice(0, 120),
              reported_symptom: userTexts.join(" ").slice(0, 500),
              category: "other",
              impact: "medium",
              reason: "human_requested",
              attempted_steps: [],
            }),
          ]);
        const feedback = /no funcion[oó]/i.test(lastText);
        return reply([
          toolUse("update_case_details", {
            area: null,
            user_goal: null,
            expected_result: null,
            observed_error: feedback ? null : lastText.slice(0, 280),
            impact: null,
            platform: null,
          }),
          // Tras un "no funcionó" se vuelve a buscar con el problema original.
          toolUse("search_articles", { query: feedback ? (userTexts[0] ?? lastText) : lastText, category: null }),
        ]);
      }

      // Resultados de herramientas del turno anterior.
      const previous = messages.at(-2);
      const uses = new Map<string, string>();
      if (previous && Array.isArray(previous.content))
        for (const block of previous.content) if (block.type === "tool_use") uses.set(block.id, block.name);
      const results = (last.content as Anthropic.ToolResultBlockParam[])
        .filter((block) => block.type === "tool_result")
        .map((block) => ({
          name: uses.get(block.tool_use_id) ?? "",
          error: block.is_error === true,
          data: unwrapUntrusted(typeof block.content === "string" ? block.content : "") as Record<string, unknown> | null,
        }));
      const byName = (name: string) => results.find((result) => result.name === name);

      const search = byName("search_articles");
      if (search) {
        const articles = ((search.data?.articles as { article_id: string; already_failed: boolean }[]) ?? []).filter((a) => !a.already_failed);
        if (articles.length > 0) return reply([toolUse("get_article", { article_id: articles[0]!.article_id })]);
        const failedBefore = userTexts.some((text) => /no funcion[oó]/i.test(text));
        if (userTexts.length >= 2 || failedBefore)
          return reply([
            toolUse("create_ticket", {
              title: (userTexts[0] ?? "Problema reportado").slice(0, 120),
              reported_symptom: userTexts.join(" ").slice(0, 500),
              category: "other",
              impact: "medium",
              reason: failedBefore ? "solution_failed" : "no_article",
              attempted_steps: [],
            }),
          ]);
        return reply([textBlock("Para ayudarte mejor: ¿en qué pantalla ocurre y qué mensaje de error ves exactamente?")]);
      }

      const article = byName("get_article");
      if (article?.data && !article.error) {
        const data = article.data as { title: string; solution: string; is_example: boolean };
        return reply([
          textBlock(
            `Encontré un artículo que puede ayudarte: **${data.title}**${data.is_example ? " (ejemplo)" : ""}.\n\n${data.solution}\n\n¿Se resolvió tu problema?`,
          ),
        ]);
      }

      const ticket = byName("create_ticket");
      if (ticket?.data && !ticket.error) {
        const data = ticket.data as { display_number: string };
        return reply([
          textBlock(`Creé el ticket ${data.display_number} con lo que me contaste. El equipo de soporte lo revisará y te avisaremos de cada avance.`),
        ]);
      }

      const proposal = byName("propose_comment_on_my_ticket") ?? byName("propose_reopen_my_ticket");
      if (proposal) {
        if (proposal.error) return reply([textBlock("No encontré ese ticket entre los tuyos o su estado no lo permite.")]);
        return reply([textBlock("Te preparé la acción. Revísala y confírmala en la tarjeta: no se hace nada hasta que la confirmes.")]);
      }

      const account = byName("get_my_account_status");
      if (account?.data && !account.error) {
        const data = account.data as { role: string; account_status: string; agency: { member: boolean } };
        return reply([
          textBlock(
            `Revisé tu cuenta: tu rol es ${data.role}, la cuenta está ${data.account_status}${data.agency.member ? " y perteneces a una agencia" : ""}. Hay una sola sesión activa por cuenta: si entras desde otro dispositivo, se cierra la anterior.`,
          ),
        ]);
      }

      const mine = byName("get_my_tickets");
      if (mine) {
        const tickets = (mine.data?.tickets as unknown[]) ?? [];
        return reply([textBlock(tickets.length ? "Estos son tus tickets." : "No encontré ese ticket entre los tuyos. Solo puedo consultar tus propios tickets.")]);
      }

      return reply([textBlock("¿Puedes contarme un poco más sobre lo que pasa?")]);
    },
  };
}
