import { useState, type FormEvent } from "react";
import type { AssignBody, TicketDetail, UpdateTicketBody } from "@reto/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isVersionConflict, useAdmins, useAssign, useUpdateTicket } from "../api";
import { useIncidents } from "@/features/catalog/api";
import { useCatalogNames } from "../useCatalogNames";
import { ConflictAlert } from "./ConflictAlert";

const UNASSIGNED = "__none";

type Pending =
  | { kind: "assign"; body: Omit<AssignBody, "version"> }
  | { kind: "update"; body: Omit<UpdateTicketBody, "version"> };

// Responsable, categoría, prioridad y etiquetas (solo equipo). Cada cambio valida la versión.
export function AdminAttributes({ ticket }: { ticket: TicketDetail }) {
  const admins = useAdmins(true);
  const incidents = useIncidents(true);
  const names = useCatalogNames();
  const assign = useAssign(ticket.id);
  const update = useUpdateTicket(ticket.id);
  const [pending, setPending] = useState<Pending | null>(null);
  const [tags, setTags] = useState((ticket.tags ?? []).join(", "));

  const error = assign.error ?? update.error;
  const conflict = isVersionConflict(error) ? error.details.current : null;

  function run(change: Pending, version = ticket.version) {
    setPending(change);
    assign.reset();
    update.reset();
    if (change.kind === "assign") assign.mutate({ ...change.body, version });
    else update.mutate({ ...change.body, version } as UpdateTicketBody);
  }

  function saveTags(event: FormEvent) {
    event.preventDefault();
    const list = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    run({ kind: "update", body: { tags: list } });
  }

  const busy = assign.isPending || update.isPending;

  return (
    <FieldGroup>
      {conflict && pending && (
        <ConflictAlert
          current={conflict}
          pending={busy}
          onRetry={() => run(pending, conflict.version)}
          onDiscard={() => {
            setPending(null);
            assign.reset();
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
        <FieldLabel htmlFor="assignee">Responsable</FieldLabel>
        <Select
          value={ticket.assignee?.id ?? UNASSIGNED}
          onValueChange={(value) => run({ kind: "assign", body: { assignee_id: value === UNASSIGNED ? null : value } })}
          disabled={busy}
        >
          <SelectTrigger id="assignee" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={UNASSIGNED}>Sin asignar</SelectItem>
              {(admins.data ?? []).map((admin) => (
                <SelectItem key={admin.id} value={admin.id}>
                  {admin.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="priority">Prioridad</FieldLabel>
        <Select value={ticket.priority} onValueChange={(priority) => run({ kind: "update", body: { priority } })} disabled={busy}>
          <SelectTrigger id="priority" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {names.priorities.map((p) => (
                <SelectItem key={p.code} value={p.code}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel htmlFor="category">Categoría</FieldLabel>
        <Select value={ticket.category} onValueChange={(category) => run({ kind: "update", body: { category } })} disabled={busy}>
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
          onValueChange={(value) => run({ kind: "update", body: { incident_id: value === UNASSIGNED ? null : value } })}
          disabled={busy}
        >
          <SelectTrigger id="incident" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={UNASSIGNED}>Ninguno</SelectItem>
              {ticket.incident && !(incidents.data ?? []).some((i) => i.id === ticket.incident?.id) && (
                <SelectItem value={ticket.incident.id}>{ticket.incident.title}</SelectItem>
              )}
              {(incidents.data ?? []).map((incident) => (
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
