import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { LifeBuoyIcon, MessageSquarePlusIcon, SendIcon, TicketIcon, UserRoundIcon } from "lucide-react";
import { checkFileBeforeUpload, isImageMime, type ChatAttachment, type ChatMessage, type Conversation } from "@reto/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Message, MessageContent } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";
import { NotFoundPage } from "@/features/errors/NotFoundPage";
import { useConversation, useConversations, useCreateConversation, useEscalate, useResolution, useSendMessage } from "./api";
import { ChatMessageView } from "./components/ChatMessages";
import { AttachButton, StagedAttachments } from "./components/ChatAttachments";
import { UploadProgress } from "@/features/attachments/FilePicker";
import { uploadChatAttachments } from "@/features/attachments/api";

export function SupportPage() {
  const { id } = useParams();
  const conversation = useConversation(id);
  const conversations = useConversations();
  // La conversación que acaba de crear el panel "nuevo": se adopta sin remontar el panel,
  // para no perder el borrador ni el aviso de error del primer mensaje.
  const [adoptedId, setAdoptedId] = useState<string | null>(null);
  const panelKey = id && id !== adoptedId ? id : "new";

  useEffect(() => {
    document.title = "RETO · Soporte";
  }, []);

  if (id && conversation.error instanceof ApiError && conversation.error.status === 404)
    return <NotFoundPage message="No encontramos esta conversación." />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-primary">Centro de ayuda</span>
          <h1 className="text-3xl font-bold tracking-tight">Soporte</h1>
          <p className="text-muted-foreground">Cuéntale al asistente qué pasa. Si no hay una solución conocida, crea un ticket por ti.</p>
        </div>
        <Button size="lg" variant="outline" asChild>
          <Link to="/tickets">
            <TicketIcon data-icon="inline-start" aria-hidden="true" />
            Mis tickets
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-3" aria-label="Conversaciones recientes">
          <Button asChild>
            <Link to="/soporte">
              <MessageSquarePlusIcon data-icon="inline-start" aria-hidden="true" />
              Nueva conversación
            </Link>
          </Button>
          <ul className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
            {(conversations.data?.pages.flatMap((page) => page.items) ?? []).map((item) => (
              <li key={item.id} className="min-w-52 lg:min-w-0">
                <Link
                  to={`/soporte/c/${item.id}`}
                  className={cn(
                    "glass flex flex-col gap-1 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-accent",
                    item.id === id && "border-brand/50 bg-accent",
                  )}
                >
                  <span className="truncate font-medium">{item.title ?? "Conversación sin título"}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ConversationBadge status={item.status} ticket={item.ticket?.display_number} />
                    {formatRelative(item.last_message_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {conversations.hasNextPage && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              // Sin carga doble: no se pide otra página mientras llega la anterior.
              disabled={conversations.isFetchingNextPage}
              onClick={() => {
                if (!conversations.isFetchingNextPage) void conversations.fetchNextPage();
              }}
            >
              {conversations.isFetchingNextPage ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
              Ver más conversaciones
            </Button>
          )}
        </aside>

        {id && conversation.isPending && panelKey !== "new" ? (
          <Skeleton className="h-[60vh] w-full" />
        ) : (
          <ChatPanel key={panelKey} conversation={id ? conversation.data : undefined} onCreated={setAdoptedId} />
        )}
      </div>
    </div>
  );
}

function ConversationBadge({ status, ticket }: { status: string; ticket?: string }) {
  if (status === "escalated") return <Badge variant="secondary">{ticket ?? "Ticket"}</Badge>;
  if (status === "resolved") return <Badge variant="outline" className="border-success/30 text-success-foreground">Resuelta</Badge>;
  return <Badge variant="outline">Activa</Badge>;
}

function ChatPanel({ conversation, onCreated }: { conversation?: Conversation; onCreated: (id: string) => void }) {
  const navigate = useNavigate();
  const createConversation = useCreateConversation();
  const send = useSendMessage();
  const resolution = useResolution();
  const escalate = useEscalate();
  const sendKey = useIdempotencyKey();
  const actionKey = useIdempotencyKey();
  const conversationKey = useIdempotencyKey();
  const [draft, setDraft] = useState("");
  const [pendingText, setPendingText] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Evidencias ya subidas a la conversación que viajan con el próximo mensaje.
  const uploadKey = useIdempotencyKey();
  const [staged, setStaged] = useState<ChatAttachment[]>([]);
  const [shareImages, setShareImages] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const busy = createConversation.isPending || send.isPending || resolution.isPending || escalate.isPending || uploadProgress !== null;
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => {
      window.clearInterval(timer);
      setElapsed(0);
    };
  }, [busy]);

  const messages = conversation?.messages ?? [];
  const escalated = conversation?.status === "escalated";
  const readOnly = conversation?.read_only ?? false;
  const error = send.error ?? resolution.error ?? escalate.error ?? createConversation.error;
  const unavailable = error instanceof ApiError && error.code === "assistant_unavailable";

  // Botones "¿Se resolvió?" en el último mensaje del asistente que propuso un artículo.
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.kind === "message");
  const lastMessage = messages.at(-1);
  const askFor =
    conversation?.status === "active" && lastAssistant && lastAssistant === lastMessage && lastAssistant.article_refs.length > 0
      ? lastAssistant
      : undefined;

  async function ensureConversation() {
    if (conversation?.id) return conversation.id;
    const id = (await createConversation.mutateAsync(conversationKey.current())).id;
    conversationKey.reset();
    onCreated(id);
    navigate(`/soporte/c/${id}`, { replace: true });
    return id;
  }

  async function pickFiles(files: File[]) {
    const problem = files.map(checkFileBeforeUpload).find(Boolean);
    if (problem) return setUploadError(problem);
    if (staged.length + files.length > 5) return setUploadError("Puedes adjuntar hasta 5 archivos por mensaje.");
    setUploadError(null);
    setUploadProgress(0);
    try {
      const id = await ensureConversation();
      const { attachments } = await uploadChatAttachments(id, files, uploadKey.current(), setUploadProgress);
      uploadKey.reset();
      setStaged((current) => [...current, ...attachments]);
    } catch (error) {
      uploadKey.reset();
      setUploadError(error instanceof Error ? error.message : "No pudimos subir los archivos.");
    } finally {
      setUploadProgress(null);
    }
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setPendingText(text);
    try {
      const id = await ensureConversation();
      // Misma clave en el reintento: el mensaje no se duplica.
      await send.mutateAsync({
        id,
        text,
        attachmentIds: staged.map((attachment) => attachment.id),
        shareImages: shareImages && staged.some((attachment) => isImageMime(attachment.mime_type)),
        idempotencyKey: sendKey.current(),
      });
      sendKey.reset();
      setDraft("");
      setStaged([]);
      setShareImages(false);
    } catch {
      // El borrador se conserva; el error se muestra abajo con opción de reintentar.
    } finally {
      setPendingText(null);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  function answer(message: ChatMessage, resolved: boolean) {
    if (!conversation) return;
    resolution.mutate(
      { id: conversation.id, body: { resolved, article_id: message.article_refs[0]!.article_id }, idempotencyKey: actionKey.current() },
      { onSuccess: () => actionKey.reset() },
    );
  }

  function talkToHuman() {
    if (!conversation) return;
    escalate.mutate(
      { id: conversation.id, note: draft.trim() || undefined, idempotencyKey: actionKey.current() },
      {
        onSuccess: () => {
          actionKey.reset();
          setDraft("");
          send.reset();
        },
      },
    );
  }

  return (
    <Card className="glass flex min-h-[60vh] flex-col gap-0 py-0">
      <CardHeader className="border-b py-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <LifeBuoyIcon aria-hidden="true" className="size-4 text-brand" />
          {conversation?.title ?? "Nueva conversación"}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col px-0">
        <MessageScrollerProvider autoScroll>
          <MessageScroller className="h-[52vh] min-h-80">
            <MessageScrollerViewport>
              <MessageScrollerContent className="flex flex-col gap-5 px-4 py-6">
                {messages.length === 0 && !pendingText && (
                  <MessageScrollerItem messageId="empty">
                    <Empty>
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <LifeBuoyIcon />
                        </EmptyMedia>
                        <EmptyTitle>¿En qué te ayudamos?</EmptyTitle>
                        <EmptyDescription>
                          Describe qué intentabas hacer, qué esperabas y qué pasó. Por ejemplo: «No puedo iniciar sesión, me dice usuario o
                          contraseña incorrectos».
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </MessageScrollerItem>
                )}
                {messages.map((message) => (
                  <MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
                    <ChatMessageView
                      message={message}
                      resolution={
                        askFor === message
                          ? { articleId: message.article_refs[0]!.article_id, pending: resolution.isPending, onAnswer: (resolved) => answer(message, resolved) }
                          : undefined
                      }
                    />
                  </MessageScrollerItem>
                ))}
                {pendingText && !messages.some((m) => m.role === "user" && m.text === pendingText) && (
                  <MessageScrollerItem messageId="pending" scrollAnchor>
                    <Message align="end">
                      <MessageContent>
                        <Bubble align="end">
                          <BubbleContent>
                            <p className="whitespace-pre-wrap">{pendingText}</p>
                          </BubbleContent>
                        </Bubble>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                )}
                {busy && (
                  <MessageScrollerItem messageId="thinking">
                    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Spinner aria-hidden="true" />
                      El asistente está pensando… {elapsed > 0 && `${elapsed} s`}
                      {elapsed >= 15 && " · Está tardando más de lo normal."}
                    </p>
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>
      </CardContent>

      <div className="flex flex-col gap-3 border-t p-4">
        {unavailable && (
          <Alert role="alert" className="border-gold/50 bg-gold-soft">
            <AlertTitle>El asistente no está disponible en este momento</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
              <span>Tu mensaje quedó guardado. Puedes reintentar o crear el ticket con lo que ya contaste: el soporte sigue funcionando sin IA.</span>
              <span className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void submit()} disabled={busy || !draft.trim()}>
                  Reintentar
                </Button>
                <Button size="sm" variant="outline" onClick={talkToHuman} disabled={busy || !conversation}>
                  Crear ticket con el formulario
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}
        {error && !unavailable && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}

        {readOnly ? (
          <p className="text-sm text-muted-foreground">Vista de solo lectura: conversación de origen del ticket.</p>
        ) : escalated && conversation?.ticket ? (
          <Alert>
            <TicketIcon aria-hidden="true" />
            <AlertDescription>
              Este caso sigue en el ticket{" "}
              <Link to={conversation.ticket.url} className="font-medium underline">
                {conversation.ticket.display_number}
              </Link>
              . Puedes responder al equipo desde ahí.
            </AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
            <Field>
              <FieldLabel htmlFor="chat-input" className="sr-only">
                Mensaje para el asistente
              </FieldLabel>
              <Textarea
                id="chat-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                maxLength={4000}
                rows={3}
                placeholder="Escribe tu mensaje. Enter para enviar, Shift+Enter para una línea nueva."
                disabled={busy}
              />
            </Field>
            <StagedAttachments
              attachments={staged}
              onRemove={(id) => setStaged((current) => current.filter((attachment) => attachment.id !== id))}
              share={shareImages}
              onShareChange={setShareImages}
              disabled={busy}
            />
            <UploadProgress value={uploadProgress} />
            {uploadError && (
              <p role="alert" className="text-xs text-destructive">
                {uploadError}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <AttachButton onPick={(files) => void pickFiles(files)} disabled={busy} />
                {conversation && messages.some((m) => m.role === "user") && (
                  <Button type="button" size="sm" variant="outline" onClick={talkToHuman} disabled={busy}>
                    <UserRoundIcon data-icon="inline-start" aria-hidden="true" />
                    Hablar con una persona
                  </Button>
                )}
              </div>
              <Button type="submit" disabled={busy || !draft.trim()}>
                {busy ? <Spinner aria-label="Enviando" data-icon="inline-start" /> : <SendIcon data-icon="inline-start" aria-hidden="true" />}
                Enviar
              </Button>
            </div>
          </form>
        )}
        <p className="text-xs text-muted-foreground">
          Respuestas generadas por IA; pueden equivocarse. Nunca te pediremos contraseñas.
        </p>
      </div>
    </Card>
  );
}
