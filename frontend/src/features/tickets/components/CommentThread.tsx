import { LockIcon, MessageSquareIcon } from "lucide-react";
import type { TicketComment } from "@reto/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { formatDateTime, formatRelative, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function CommentThread({ comments }: { comments: TicketComment[] }) {
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
              <p className="text-sm whitespace-pre-wrap">{comment.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
