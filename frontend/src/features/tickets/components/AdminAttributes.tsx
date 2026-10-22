import { useState, type FormEvent } from "react";
import type { TicketDetail, UpdateTicketBody } from "@reto/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PriorityOption } from "./badges";
import { isVersionConflict, useUpdateTicket } from "../api";
import { useIncidents } from "@/features/catalog/api";
import { useCatalogNames } from "../useCatalogNames";
import { ConflictAlert } from "./ConflictAlert";
import { toast } from "@/components/feedback/toast-store";

const UNASSIGNED = "__none";

type Pending = Omit<UpdateTicketBody, "version">;

// Prioridad, categoría, incidente y etiquetas (solo equipo). El responsable va en
// AssigneePicker. Cada cambio valida la versión.
export function AdminAttributes({ ticket }: { ticket: TicketDetail }) {
  const incidents = useIncidents(true);
  const names = useCatalogNames();
  const update = useUpdateTicket(ticket.id);
  const [pending, setPending] = useState<Pending | null>(null);
  const [tags, setTags] = useState((ticket.tags ?? []).join(", "));

  const error = update.error;
  const conflict = isVersionConflict(error) ? error.details.current : null;

  function run(change: Pending, version = ticket.version) {
    setPending(change);
    update.reset();
    update.mutate({ ...change, version } as UpdateTicketBody, { onSuccess: () => toast.success(successMessage(change)) });
  }

  function successMessage(change: Pending) {
    if (change.priority) return `Prioridad: ${names.priorityName(change.priority)}`;
    if (change.category) return `Categoría: ${names.categoryName(change.category)}`;
    if (change.incident_id !== undefined) return change.incident_id ? "Incidente vinculado" : "Incidente desvinculado";
    return "Etiquetas guardadas";
  }

  function saveTags(event: FormEvent) {
    event.preventDefault();
    const list = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    run({ tags: list });
  }

  const busy = update.isPending;

  return (
    <FieldGroup>
      {conflict && pending && (
        <ConflictAlert
          current={conflict}
          pending={busy}
          onRetry={() => run(pending, conflict.version)}
          onDiscard={() => {
            setPending(null);
            update.reset();
            setTags((conflict.tags ?? []).join(", "));
          }}
        />
      )}
      {error && !conflict && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <Field>
        <FieldLabel htmlFor="priority">Prioridad</FieldLabel>
        <Select value={ticket.priority} onValueChange={(priority) => run({ priority })} disabled={busy}>
          <SelectTrigger id="priority" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {names.priorities.map((p) => (
                <SelectItem key={p.code} value={p.code}>
                  <PriorityOption code={p.code} name={p.name} />
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="category">Categoría</FieldLabel>
        <Select value={ticket.category} onValueChange={(category) => run({ category })} disabled={busy}>
          <SelectTrigger id="category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {names.categories.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="incident">Incidente conocido</FieldLabel>
        <Select
          value={ticket.incident?.id ?? UNASSIGNED}
          onValueChange={(value) => run({ incident_id: value === UNASSIGNED ? null : value })}
          disabled={busy}
        >
          <SelectTrigger id="incident" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={UNASSIGNED}>Ninguno</SelectItem>
              {ticket.incident && !(incidents.data?.items ?? []).some((i) => i.id === ticket.incident?.id) && (
                <SelectItem value={ticket.incident.id}>{ticket.incident.title}</SelectItem>
              )}
              {(incidents.data?.items ?? []).map((incident) => (
                <SelectItem key={incident.id} value={incident.id}>
                  {incident.title}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <form onSubmit={saveTags}>
        <Field>
          <FieldLabel htmlFor="tags">Etiquetas</FieldLabel>
          <div className="flex gap-2">
            <Input id="tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="exportar, permisos" />
            <Button type="submit" variant="outline" disabled={busy}>
              Guardar
            </Button>
          </div>
          {(ticket.tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ticket.tags?.map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </Field>
      </form>
    </FieldGroup>
  );
}
