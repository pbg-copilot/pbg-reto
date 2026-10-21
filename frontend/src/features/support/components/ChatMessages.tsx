import { Link } from "react-router";
import { AlertTriangleIcon, BookOpenIcon, BotIcon, CheckIcon, ShieldAlertIcon, ShieldCheckIcon, TicketIcon, XIcon } from "lucide-react";
import type { ArticleRef, ChatMessage, TicketRef } from "@reto/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { MessageAttachments } from "./ChatAttachments";
import { ActionCard } from "./ActionCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageAvatar, MessageContent, MessageFooter } from "@/components/ui/message";
import { Markdown } from "@/components/Markdown";
import { formatRelative } from "@/lib/format";
import { StatusBadge } from "@/features/tickets/components/badges";

export function ArticleCard({ article }: { article: ArticleRef }) {
  return (
    <Card size="sm" className="glass w-full max-w-md gap-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <BookOpenIcon aria-hidden="true" className="size-4 shrink-0 text-brand" />
          {article.title}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2 text-xs">
          Artículo del catálogo · versión {article.version}
          {article.is_example && (
            <Badge variant="outline" className="border-gold/40 text-gold-foreground">
              Ejemplo
            </Badge>
          )}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button size="sm" variant="outline" asChild>
          <Link to={article.url}>Ver artículo</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

// Solo con datos que confirmó el backend (número, estado y enlace reales).
export function TicketCard({ ticket }: { ticket: TicketRef }) {
  return (
    <Card size="sm" className="glass w-full max-w-md gap-2 border-brand/40" data-testid="ticket-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <TicketIcon aria-hidden="true" className="size-4 shrink-0 text-brand" />
          {ticket.display_number}
          <StatusBadge status={ticket.status} />
        </CardTitle>
        <CardDescription className="text-xs">{ticket.title}</CardDescription>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        El equipo de soporte lo revisará. Recibirás un aviso con cada cambio.
      </CardContent>
      <CardFooter>
        <Button size="sm" asChild>
          <Link to={ticket.url}>Abrir ticket</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

export function ChatMessageView({
  message,
  resolution,
  conversationId,
  readOnly,
}: {
  message: ChatMessage;
  // Botones "¿Se resolvió?" para el último mensaje con artículo.
  resolution?: { articleId: string; pending: boolean; onAnswer: (resolved: boolean) => void };
  conversationId?: string;
  readOnly?: boolean;
}) {
  if (message.notice === "assistant_unavailable")
    return (
      <Marker>
        <MarkerIcon>
          <AlertTriangleIcon aria-hidden="true" className="text-gold" />
        </MarkerIcon>
        <MarkerContent>{message.text}</MarkerContent>
      </Marker>
    );

  const user = message.role === "user";
  return (
    <Message align={user ? "end" : "start"}>
      {!user && (
        <MessageAvatar>
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary text-primary-foreground">
              <BotIcon aria-hidden="true" className="size-4" />
            </AvatarFallback>
          </Avatar>
        </MessageAvatar>
      )}
      <MessageContent>
        <Bubble align={user ? "end" : "start"} variant={user ? (message.kind === "resolution_feedback" ? "secondary" : "default") : "outline"}>
          <BubbleContent className={user ? undefined : "bg-card"}>
            {user ? <p className="whitespace-pre-wrap">{message.text}</p> : <Markdown>{message.text}</Markdown>}
          </BubbleContent>
        </Bubble>
        {user && <MessageAttachments attachments={message.attachments} />}
        {!user && message.evidence.includes("account_status") && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="evidence-account">
            <ShieldCheckIcon aria-hidden="true" className="size-3.5 text-success" />
            Basado en los datos de tu cuenta
          </span>
        )}
        {message.article_refs.map((article) => (
          <ArticleCard key={article.version_id} article={article} />
        ))}
        {message.ticket_ref && <TicketCard ticket={message.ticket_ref} />}
        {conversationId &&
          message.actions.map((action) => <ActionCard key={action.id} action={action} conversationId={conversationId} readOnly={readOnly ?? false} />)}
        {resolution && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="¿Se resolvió tu problema?">
            <span className="text-sm font-medium">¿Se resolvió tu problema?</span>
            <Button size="sm" disabled={resolution.pending} onClick={() => resolution.onAnswer(true)}>
              <CheckIcon data-icon="inline-start" aria-hidden="true" />
              Sí, se resolvió
            </Button>
            <Button size="sm" variant="outline" disabled={resolution.pending} onClick={() => resolution.onAnswer(false)}>
              <XIcon data-icon="inline-start" aria-hidden="true" />
              No, sigue igual
            </Button>
          </div>
        )}
        {message.notice === "secret_redacted" && (
          <p className="flex items-center gap-1 text-xs text-gold-foreground">
            <ShieldAlertIcon aria-hidden="true" className="size-3.5" />
            Ocultamos un dato que parecía una contraseña o código. Nunca los compartas por aquí.
          </p>
        )}
        <MessageFooter>
          {user ? "Tú" : "Asistente"} · {formatRelative(message.created_at)}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}
