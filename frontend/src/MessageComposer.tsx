import type { FormEvent, KeyboardEvent } from "react";
import { Arrow } from "./ui";

type Props = {
  draft: string;
  assistantEnabled: boolean;
  hasActiveClient: boolean;
  busy: boolean;
  conversationLoading: boolean;
  activeConversation: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
};

export function MessageComposer({ draft, assistantEnabled, hasActiveClient, busy, conversationLoading, activeConversation, onDraftChange, onSend }: Props) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSend();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  };

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="message-draft" className="sr-only">Escribe una pregunta o solicitud de cita</label>
      <textarea
        id="message-draft"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Pregunta algo o escribe “Agendar cita”…"
        maxLength={4000}
        rows={2}
        disabled={conversationLoading || !activeConversation}
      />
      <div className="composer-bottom">
        <span>{assistantEnabled ? "Puedes consultar al asistente o escribir “Agendar cita”." : "IA deshabilitada; puedes escribir “Agendar cita”."} Enter para enviar · Shift+Enter para nueva línea.</span>
        <button className="composer-submit" type="submit" disabled={!draft.trim() || !hasActiveClient || busy || conversationLoading}>
          {busy ? "Procesando…" : "Enviar"}<Arrow />
        </button>
      </div>
    </form>
  );
}

