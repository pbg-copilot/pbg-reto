import type { Notification } from "@reto/shared";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

// Fila común de la campana y de la bandeja: título, extracto y fecha; punto si no está leída.
export function NotificationRow({ notification, compact = false }: { notification: Notification; compact?: boolean }) {
  const unread = notification.read_at === null;
  return (
    <div className="flex w-full min-w-0 items-start gap-3">
      <span
        aria-hidden="true"
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-primary" : "bg-transparent")}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-sm", unread ? "font-semibold" : "font-medium text-muted-foreground")}>
          {notification.title}
          {unread && <span className="sr-only"> (sin leer)</span>}
        </span>
        {notification.body && (
          <span className={cn("text-sm text-muted-foreground", compact && "line-clamp-2")}>{notification.body}</span>
        )}
        <time dateTime={notification.created_at} title={formatDateTime(notification.created_at)} className="text-xs text-muted-foreground">
          {formatRelative(notification.created_at)}
        </time>
      </div>
    </div>
  );
}
