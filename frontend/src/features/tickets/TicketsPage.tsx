import { useEffect, useState } from "react";
import { Link, useNavigate, useOutletContext, useSearchParams } from "react-router";
import { BellDotIcon, InboxIcon, PlusIcon, SearchIcon, UserCheckIcon } from "lucide-react";
import { isAdmin, type Agent, type TicketStatus, type TicketSummary } from "@reto/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAdmins, useTakeCase, useTicketList, type TicketFilters } from "./api";
import { ApiError } from "@/lib/api";
import { toast } from "@/components/feedback/toast-store";
import { PriorityBadge, StatusBadge } from "./components/badges";
import { useCatalogNames } from "./useCatalogNames";
import { Pager } from "@/components/pagination/Pager";

const VIEWS: { value: TicketStatus; label: string }[] = [
  { value: "open", label: "Abiertos" },
  { value: "in_review", label: "En revisión" },
  { value: "closed", label: "Cerrados" },
];

const SORTS = [
  { value: "updated_at:desc", label: "Actividad reciente" },
  { value: "created_at:desc", label: "Más nuevos" },
  { value: "created_at:asc", label: "Más antiguos" },
  { value: "priority:desc", label: "Mayor prioridad" },
];

const ALL = "__all";
const PAGE_SIZE = "20";

export function TicketsPage() {
  const agent = useOutletContext<Agent>();
  const admin = isAdmin(agent);
  const [params, setParams] = useSearchParams();
  const names = useCatalogNames();
  const admins = useAdmins(admin);

  const filters: TicketFilters = {
    view: params.get("view") ?? "open",
    q: params.get("q") ?? undefined,
    category: params.get("category") ?? undefined,
    priority: params.get("priority") ?? undefined,
    assignee: admin ? (params.get("assignee") ?? undefined) : undefined,
    age: admin ? (params.get("age") ?? undefined) : undefined,
    unattended: admin && params.get("unattended") === "true" ? "true" : undefined,
    waiting: admin ? (params.get("waiting") ?? undefined) : undefined,
    sort: params.get("sort") ?? "updated_at",
    order: params.get("order") ?? "desc",
    page: params.get("page") ?? "1",
    page_size: PAGE_SIZE,
  };
  const list = useTicketList(filters);
  const recent = useTicketList({ unread: "true", page_size: "5", sort: "updated_at", order: "desc" });

  // Los filtros viven en la URL: se pueden compartir y sobreviven a una recarga.
  function update(changes: Record<string, string | undefined>, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined || value === "" || value === ALL) next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.delete("page");
    setParams(next, { replace: true });
  }

  const [search, setSearch] = useState(filters.q ?? "");
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if ((params.get("q") ?? "") !== search.trim()) update({ q: search.trim() || undefined });
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reacciona al texto escrito
  }, [search]);

  useEffect(() => {
    document.title = admin ? "RETO · Tickets" : "RETO · Mis tickets";
  }, [admin]);

  const page = Number(filters.page);
  const recentItems = recent.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-primary">{admin ? "Gestión de soporte" : "Seguimiento"}</span>
          <h1 className="text-3xl font-bold tracking-tight">{admin ? "Tickets" : "Mis tickets"}</h1>
          <p className="text-muted-foreground">
            {admin
              ? "Todos los casos de los solicitantes. Filtra, asigna y atiende."
              : "Tus casos con el equipo de soporte. Solo tú y el equipo pueden verlos."}
          </p>
        </div>
        <div className="flex gap-2">
          {!admin && (
            <Button variant="outline" asChild>
              <Link to="/soporte">Hablar con el asistente</Link>
            </Button>
          )}
          <Button asChild>
            <Link to="/tickets/nuevo">
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Nuevo ticket
            </Link>
          </Button>
        </div>
      </div>

      {recentItems.length > 0 && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellDotIcon aria-hidden="true" className="size-4 text-brand" />
              Actualizaciones recientes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {recentItems.map((ticket) => (
                <li key={ticket.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link to={`/tickets/${ticket.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                    <span className="text-muted-foreground">{ticket.display_number}</span> · {ticket.title}
                  </Link>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <StatusBadge status={ticket.status} />
                    {formatRelative(ticket.updated_at)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Tabs value={filters.view} onValueChange={(view) => update({ view })}>
        <TabsList>
          {VIEWS.map((view) => (
            <TabsTrigger key={view.value} value={view.value}>
              {view.label}
              <span className="ml-1 text-xs text-muted-foreground tabular-nums">
                {list.data?.counts[view.value] ?? "–"}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="ticket-search">Buscar</Label>
          <InputGroup className="h-9">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id="ticket-search"
              type="search"
              placeholder="Número (TCK-000012), título o descripción"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
        </div>
        <FilterSelect
          id="filter-category"
          label="Categoría"
          value={filters.category}
          onChange={(category) => update({ category })}
          options={names.categories.map((c) => ({ value: c.code, label: c.name }))}
        />
        <FilterSelect
          id="filter-priority"
          label="Prioridad"
          value={filters.priority}
          onChange={(priority) => update({ priority })}
          options={names.priorities.map((p) => ({ value: p.code, label: p.name }))}
        />
        {admin && (
          <>
            <FilterSelect
              id="filter-assignee"
              label="Responsable"
              allLabel="Todos"
              value={filters.assignee}
              onChange={(assignee) => update({ assignee })}
              options={[
                { value: "me", label: "Asignados a mí" },
                { value: "unassigned", label: "Sin asignar" },
                ...(admins.data ?? []).filter((a) => a.id !== agent.id).map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
            <FilterSelect
              id="filter-age"
              label="Antigüedad"
              allLabel="Cualquiera"
              value={filters.age}
              onChange={(age) => update({ age })}
              options={[
                { value: "gt_24h", label: "Más de 24 h" },
                { value: "gt_72h", label: "Más de 72 h" },
                { value: "gt_7d", label: "Más de 7 días" },
              ]}
            />
            <FilterSelect
              id="filter-waiting"
              label="En espera"
              allLabel="Todos"
              value={filters.waiting}
              onChange={(waiting) => update({ waiting })}
              options={[
                { value: "team", label: "Esperan al equipo" },
                { value: "requester", label: "Esperan al solicitante" },
              ]}
            />
            <div className="flex h-9 items-center gap-2">
              <Checkbox
                id="filter-unattended"
                checked={filters.unattended === "true"}
                onCheckedChange={(checked) => update({ unattended: checked === true ? "true" : undefined })}
              />
              <Label htmlFor="filter-unattended">Sin atender</Label>
            </div>
          </>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-sort">Ordenar</Label>
          <Select
            value={`${filters.sort}:${filters.order}`}
            onValueChange={(value) => {
              const [sort, order] = value.split(":");
              update({ sort, order });
            }}
          >
            <SelectTrigger id="filter-sort" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {SORTS.map((sort) => (
                  <SelectItem key={sort.value} value={sort.value}>
                    {sort.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {list.isError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{list.error.message}</AlertDescription>
        </Alert>
      )}

      {list.isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : list.data && list.data.items.length === 0 ? (
        <Empty className="glass rounded-xl">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon />
            </EmptyMedia>
            <EmptyTitle>No hay tickets en esta vista</EmptyTitle>
            <EmptyDescription>
              {filters.q || filters.category || filters.priority
                ? "Prueba con otros filtros o busca por número."
                : admin
                  ? "Cuando un solicitante escale un caso, aparecerá aquí."
                  : "Si tienes un problema, el asistente puede ayudarte o crear un ticket por ti."}
            </EmptyDescription>
          </EmptyHeader>
          {!admin && (
            <EmptyContent>
              <Button asChild>
                <Link to="/soporte">Ir a soporte</Link>
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <TicketTable items={list.data?.items ?? []} admin={admin} names={names} />
      )}

      {list.data && (
        <Pager
          page={page}
          pageSize={Number(PAGE_SIZE)}
          total={list.data.total}
          noun={["ticket", "tickets"]}
          loading={list.isPlaceholderData}
          onPageChange={(next) => update({ page: String(next) }, false)}
        />
      )}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
  allLabel = "Todas",
}: {
  id: string;
  label: string;
  value?: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? ALL} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL}>{allLabel}</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

type Names = ReturnType<typeof useCatalogNames>;

function TicketTable({ items, admin, names }: { items: TicketSummary[]; admin: boolean; names: Names }) {
  const navigate = useNavigate();
  const agent = useOutletContext<Agent>();
  const take = useTakeCase();
  // Tomar caso: abiertos y sin responsable (reasignar se hace desde el detalle).
  const canTake = (ticket: TicketSummary) => admin && ticket.status === "open" && !ticket.assignee;
  function takeCase(ticket: TicketSummary) {
    take.mutate(
      { id: ticket.id, meId: agent.id },
      {
        onSuccess: () => toast.success(`Tomaste ${ticket.display_number}`, { description: "Quedó asignado a ti y en revisión." }),
        onError: (error) =>
          toast.error("No se pudo tomar el caso", {
            description: error instanceof ApiError && error.status === 409 ? `${error.message} La bandeja se actualizó.` : error.message,
          }),
      },
    );
  }
  return (
    <>
      {/* Escritorio: tabla. */}
      <div className="glass hidden overflow-hidden rounded-xl md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">Número</TableHead>
              <TableHead>Título</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Prioridad</TableHead>
              {admin && <TableHead>Solicitante</TableHead>}
              {admin && <TableHead>Responsable</TableHead>}
              <TableHead className="text-right">Actividad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((ticket) => (
              <TableRow
                key={ticket.id}
                className={cn("cursor-pointer", ticket.unread && "bg-accent/40")}
                onClick={() => navigate(`/tickets/${ticket.id}`)}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">{ticket.display_number}</TableCell>
                <TableCell className="max-w-md">
                  <div className="flex items-center gap-2">
                    {ticket.unread && <UnreadDot />}
                    <Link
                      to={`/tickets/${ticket.id}`}
                      className={cn("truncate hover:underline", ticket.unread && "font-semibold")}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {ticket.title}
                    </Link>
                  </div>
                  <span className="text-xs text-muted-foreground">{names.categoryName(ticket.category)}</span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={ticket.status} />
                    {ticket.unattended && (
                      <Badge variant="outline" className="border-destructive/40 text-destructive">
                        Sin atender
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <PriorityBadge code={ticket.priority} name={names.priorityName(ticket.priority)} />
                </TableCell>
                {admin && <TableCell className="text-sm">{ticket.requester.name}</TableCell>}
                {admin && (
                  <TableCell className="text-sm text-muted-foreground">
                    <div className="flex flex-col items-start gap-1">
                      {ticket.assignee?.name ?? "Sin asignar"}
                      {canTake(ticket) && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={take.isPending && take.variables?.id === ticket.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            takeCase(ticket);
                          }}
                        >
                          <UserCheckIcon data-icon="inline-start" aria-hidden="true" />
                          Tomar caso
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
                <TableCell className="text-right text-xs text-muted-foreground">
                  <span title={formatDateTime(ticket.updated_at)}>{formatRelative(ticket.updated_at)}</span>
                  {admin && (
                    <div>
                      Últ. respuesta:{" "}
                      {ticket.last_team_reply_at ? formatRelative(ticket.last_team_reply_at) : "ninguna"}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Móvil: tarjetas. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {items.map((ticket) => (
          <li key={ticket.id} className="glass flex flex-col gap-2 rounded-xl">
            <Link to={`/tickets/${ticket.id}`} className="flex flex-col gap-2 rounded-xl p-4 pb-2">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-2 font-mono">
                  {ticket.unread && <UnreadDot />}
                  {ticket.display_number}
                </span>
                {formatRelative(ticket.updated_at)}
              </div>
              <span className={cn("font-medium", ticket.unread && "font-semibold")}>{ticket.title}</span>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={ticket.status} />
                <PriorityBadge code={ticket.priority} name={names.priorityName(ticket.priority)} />
                {admin && ticket.unattended && (
                  <Badge variant="outline" className="border-destructive/40 text-destructive">
                    Sin atender
                  </Badge>
                )}
              </div>
            </Link>
            {canTake(ticket) && (
              <Button size="sm" variant="outline" className="mx-4 mb-3 self-start" disabled={take.isPending && take.variables?.id === ticket.id} onClick={() => takeCase(ticket)}>
                <UserCheckIcon data-icon="inline-start" aria-hidden="true" />
                Tomar caso
              </Button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function UnreadDot() {
  return (
    <span className="size-2 shrink-0 rounded-full bg-brand" role="img" aria-label="Con novedades sin leer" />
  );
}
