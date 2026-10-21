import { useEffect } from "react";
import { Link, useSearchParams } from "react-router";
import { BellOffIcon, CheckCheckIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMarkAllRead, useMarkRead, useNotifications } from "./api";
import { NotificationRow } from "./components";
import { toast } from "@/components/feedback/toast-store";

const PAGE_SIZE = 20;

// Bandeja persistente: sigue ahí aunque el usuario no estuviera conectado (AC-005.4).
export function NotificationsPage() {
  const [params, setParams] = useSearchParams();
  const unreadOnly = params.get("vista") === "no-leidas";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const list = useNotifications({ unread: unreadOnly, page, page_size: PAGE_SIZE });
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const totalPages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  const unread = list.data?.unread_count ?? 0;

  useEffect(() => {
    document.title = "RETO · Notificaciones";
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-primary">Bandeja</span>
          <h1 className="text-3xl font-bold tracking-tight">Notificaciones</h1>
          <p className="text-muted-foreground">Cambios de estado y respuestas de tus tickets.</p>
        </div>
        <Button variant="outline" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate(undefined, { onSuccess: () => toast.success("Notificaciones marcadas como leídas") })}>
          <CheckCheckIcon data-icon="inline-start" aria-hidden="true" />
          Marcar todas como leídas
        </Button>
      </div>

      <Tabs value={unreadOnly ? "no-leidas" : "todas"} onValueChange={(value) => setParams(value === "todas" ? {} : { vista: value })}>
        <TabsList>
          <TabsTrigger value="todas">Todas</TabsTrigger>
          <TabsTrigger value="no-leidas">No leídas{unread ? ` (${unread})` : ""}</TabsTrigger>
        </TabsList>
      </Tabs>

      {list.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{list.error.message}</AlertDescription>
        </Alert>
      ) : list.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : list.data.items.length === 0 ? (
        <Empty className="glass rounded-xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BellOffIcon />
            </EmptyMedia>
            <EmptyTitle>{unreadOnly ? "Estás al día" : "Aún no tienes notificaciones"}</EmptyTitle>
            <EmptyDescription>Te avisaremos aquí cuando cambie el estado de un ticket o el equipo responda.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card" aria-label="Notificaciones">
          {list.data.items.map((notification) => (
            <li key={notification.id}>
              <Link
                to={notification.link}
                onClick={() => {
                  if (!notification.read_at) markRead.mutate(notification.id);
                }}
                className="flex px-4 py-3 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <NotificationRow notification={notification} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav aria-label="Paginación" className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setParams({ ...Object.fromEntries(params), page: String(page - 1) })}
          >
            <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setParams({ ...Object.fromEntries(params), page: String(page + 1) })}
          >
            Siguiente
            <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
        </nav>
      )}
    </div>
  );
}
