import { useState } from "react";
import { useNavigate } from "react-router";
import { BellIcon, CheckCheckIcon, InboxIcon } from "lucide-react";
import type { Notification } from "@reto/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from "./api";
import { NotificationRow } from "./components";
import { toast } from "@/components/feedback/toast-store";

// Campana de la barra superior: contador con polling y las últimas 10 al abrir.
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const count = useUnreadCount();
  const recent = useNotifications({ page_size: 10 }, { enabled: open });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const navigate = useNavigate();
  const unread = count.data ?? 0;

  // Abrir marca como leída y navega. El detalle vuelve a verificar permisos (404 amable).
  function openNotification(notification: Notification) {
    if (!notification.read_at) markRead.mutate(notification.id);
    void navigate(notification.link);
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread ? `Notificaciones, ${unread} sin leer` : "Notificaciones"}
          data-testid="notification-bell"
        >
          <BellIcon />
          {unread > 0 && (
            <span
              aria-hidden="true"
              data-testid="notification-count"
              className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(24rem,calc(100vw-2rem))]">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          <span>Notificaciones</span>
          {unread > 0 && <span className="text-xs font-normal text-muted-foreground">{unread} sin leer</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recent.isPending ? (
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        ) : recent.data?.items.length ? (
          <DropdownMenuGroup>
            {recent.data.items.map((notification) => (
              <DropdownMenuItem key={notification.id} className="py-2" onSelect={() => openNotification(notification)}>
                <NotificationRow notification={notification} compact />
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ) : (
          <p className="p-4 text-center text-sm text-muted-foreground">No tienes notificaciones.</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {unread > 0 && (
            <DropdownMenuItem
              disabled={markAll.isPending}
              onSelect={(event) => {
                event.preventDefault();
                markAll.mutate(undefined, { onSuccess: () => toast.success("Notificaciones marcadas como leídas") });
              }}
            >
              <CheckCheckIcon />
              Marcar todas como leídas
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => void navigate("/notificaciones")}>
            <InboxIcon />
            Ver todas
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
