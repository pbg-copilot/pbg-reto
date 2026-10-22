import { LockIcon, MessageSquareIcon } from "lucide-react";
import type { Attachment, TicketComment } from "@reto/shared";
import { AttachmentList } from "@/features/attachments/AttachmentList";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { formatDateTime, formatRelative, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/Markdown";

// Negritas, listas o títulos: se renderiza como Markdown (sin HTML crudo ni imágenes).
const looksLikeMarkdown = (text: string) => /(\*\*[^*]+\*\*|^\s*[-*] \S|^\s*\d+\. \S|^#{1,3} )/m.test(text);

export function CommentThread({
  comments,
  attachments = [],
  ticketId,
  canRemoveAttachments = false,
}: {
  comments: TicketComment[];
  attachments?: Attachment[];
  ticketId: string;
  canRemoveAttachments?: boolean;
}) {
  if (comments.length === 0)
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquareIcon />
          </EmptyMedia>
          <EmptyTitle>Todavía no hay comentarios</EmptyTitle>
          <EmptyDescription>Las respuestas del equipo y del solicitante aparecerán aquí.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );

  return (
    <ol className="flex flex-col gap-4">
      {comments.map((comment) => {
        const internal = comment.visibility === "internal";
        return (
          <li
            key={comment.id}
            className={cn(
              "flex gap-3 rounded-xl border p-4",
              internal ? "border-gold/40 bg-gold-soft" : "bg-card",
            )}
          >
            <Avatar className="size-9">
              <AvatarFallback className={cn("text-xs font-semibold", comment.author.is_team && "bg-primary text-primary-foreground")}>
                {initials(comment.author.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <strong className="font-semibold">{comment.author.name}</strong>
                {comment.author.is_team && <Badge variant="secondary">Equipo de soporte</Badge>}
                {internal && (
                  <Badge variant="outline" className="border-gold/50 text-gold-foreground">
                    <LockIcon data-icon="inline-start" aria-hidden="true" />
                    Nota interna · solo equipo
                  </Badge>
                )}
                {comment.requests_info && (
                  <Badge variant="outline" className="border-brand/40 text-primary dark:text-brand">
                    Solicitud de información
                  </Badge>
                )}
                <time
                  dateTime={comment.created_at}
                  title={formatDateTime(comment.created_at)}
                  className="text-xs text-muted-foreground"
                >
                  {formatRelative(comment.created_at)}
                  {comment.edited_at && " · editado"}
                </time>
              </div>
              {/* Las respuestas y notas del copiloto vienen en Markdown; el texto común se muestra tal cual. */}
              {looksLikeMarkdown(comment.body) ? <Markdown>{comment.body}</Markdown> : <p className="text-sm whitespace-pre-wrap">{comment.body}</p>}
              <div className="mt-2 empty:hidden">
                <AttachmentList
                  attachments={attachments.filter((attachment) => attachment.comment_id === comment.id)}
                  ticketId={ticketId}
                  canRemove={canRemoveAttachments}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
