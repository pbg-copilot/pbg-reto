import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDownIcon, UserCheckIcon, UserMinusIcon, UserRoundIcon } from "lucide-react";
import type { SupportAdmin, TicketDetail } from "@reto/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/feedback/toast-store";
import { initials } from "@/lib/format";
import { isVersionConflict, supportKeys, useAdmins, useAssign } from "../api";
import { ConflictAlert } from "./ConflictAlert";

const workload = (count: number) => (count === 0 ? "Sin casos abiertos" : count === 1 ? "1 abierto" : `${count} abiertos`);

// Responsable del ticket (solo equipo). Patrón de Linear/Zendesk: "Asignarme" en un clic,
// búsqueda con la carga de cada admin y "Deshacer" en el aviso. Cada cambio valida la versión.
export function AssigneePicker({ ticket, meId }: { ticket: TicketDetail; meId: string }) {
  const admins = useAdmins(true);
  const assign = useAssign(ticket.id);
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null | undefined>(undefined);
  const conflict = isVersionConflict(assign.error) ? assign.error.details.current : null;
  const current = ticket.assignee ?? null;
  const currentAdmin = admins.data?.find((admin) => admin.id === current?.id);

  // "Deshacer" llama a change desde el aviso, con la versión nueva: no compara con el
  // responsable de este render (ya quedó viejo) ni ofrece otro "Deshacer".
  function change(assigneeId: string | null, { version = ticket.version, undoable = true } = {}) {
    const previous = current?.id ?? null;
    if (undoable && assigneeId === previous) return setOpen(false);
    setPending(assigneeId);
    setOpen(false);
    assign.reset();
    assign.mutate(
      { assignee_id: assigneeId, version },
      {
        onSuccess: (updated) => {
          setPending(undefined);
          // La carga de cada admin cambió.
          void client.invalidateQueries({ queryKey: supportKeys.admins });
          const name = updated.assignee?.name;
          const title = !name ? "Se quitó el responsable" : updated.assignee?.id === meId ? "Ahora eres responsable" : `Asignado a ${name}`;
          toast.success(title, {
            description: updated.display_number,
            action: undoable ? { label: "Deshacer", onClick: () => change(previous, { version: updated.version, undoable: false }) } : undefined,
          });
        },
      },
    );
  }

  return (
    <section aria-labelledby="assignee-label" className="flex flex-col gap-3">
      <span id="assignee-label" className="eyebrow">
        Responsable
      </span>
      {conflict && pending !== undefined && (
        <ConflictAlert
          current={conflict}
          pending={assign.isPending}
          onRetry={() => change(pending, { version: conflict.version })}
          onDiscard={() => {
            setPending(undefined);
            assign.reset();
          }}
        />
      )}
      {assign.error && !conflict && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{assign.error.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3" data-testid="assignee-current">
        {current ? (
          <Avatar className="size-9">
            <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">{initials(current.name)}</AvatarFallback>
          </Avatar>
        ) : (
          <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full border border-dashed text-muted-foreground">
            <UserRoundIcon className="size-4" />
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">
            {current ? current.name : "Sin asignar"}
            {current?.id === meId && (
              <Badge variant="secondary" className="ml-2 align-middle">
                Tú
              </Badge>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {current ? (currentAdmin ? workload(currentAdmin.open_tickets) : "Administrador") : "Nadie tiene este caso todavía"}
          </span>
        </div>
        {assign.isPending && <Spinner className="ml-auto" />}
      </div>

      <div className="flex flex-wrap gap-2">
        {current?.id !== meId && (
          <Button variant="outline" className="flex-1 sm:flex-none" disabled={assign.isPending} onClick={() => change(meId)}>
            <UserCheckIcon data-icon="inline-start" aria-hidden="true" />
            Asignarme
          </Button>
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="flex-1 sm:flex-none"
              disabled={assign.isPending}
              aria-label="Cambiar responsable"
              aria-haspopup="listbox"
            >
              {current ? "Cambiar" : "Elegir responsable"}
              <ChevronsUpDownIcon data-icon="inline-end" aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(20rem,calc(100vw-2rem))] p-0">
            {/* cmdk nombra el input con la etiqueta del Command (aria-labelledby), no con aria-label. */}
            <Command label="Buscar administrador">
              <CommandInput placeholder="Buscar administrador…" />
              <CommandList>
                <CommandEmpty>{admins.isPending ? "Cargando…" : "Sin resultados"}</CommandEmpty>
                <CommandGroup heading="Equipo de soporte">
                  {(admins.data ?? []).map((admin) => (
                    <AdminOption key={admin.id} admin={admin} me={admin.id === meId} checked={admin.id === current?.id} onSelect={() => change(admin.id)} />
                  ))}
                </CommandGroup>
                {current && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem value="__unassign" keywords={["quitar", "sin asignar"]} onSelect={() => change(null)}>
                        <UserMinusIcon aria-hidden="true" />
                        Quitar responsable
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </section>
  );
}

function AdminOption({ admin, me, checked, onSelect }: { admin: SupportAdmin; me: boolean; checked: boolean; onSelect: () => void }) {
  return (
    <CommandItem value={admin.id} keywords={[admin.name]} data-checked={checked} onSelect={onSelect}>
      <Avatar className="size-7">
        <AvatarFallback className="text-[10px] font-semibold">{initials(admin.name)}</AvatarFallback>
      </Avatar>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">
          {admin.name}
          {me && <span className="text-muted-foreground"> (tú)</span>}
        </span>
        <span className="text-xs text-muted-foreground">{workload(admin.open_tickets)}</span>
      </span>
    </CommandItem>
  );
}
