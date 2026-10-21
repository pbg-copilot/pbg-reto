import { useState, type FormEvent } from "react";
import { CheckCircle2Icon, PlayIcon, RotateCcwIcon } from "lucide-react";
import {
  CLOSURE_REASONS,
  closureReasonLabel,
  parseTicketNumber,
  type ChangeStatusBody,
  type ClosureReason,
  type TicketDetail,
} from "@reto/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useIdempotencyKey } from "@/lib/idempotency";
import { isVersionConflict, useChangeStatus, useReopen } from "../api";
import { ConflictAlert } from "./ConflictAlert";
import { toast } from "@/components/feedback/toast-store";

type StatusChange = Omit<ChangeStatusBody, "version">;

// Acciones de estado: el equipo toma y cierra casos; el solicitante (o el equipo) reabre.
export function StatusActions({ ticket }: { ticket: TicketDetail }) {
  const changeStatus = useChangeStatus(ticket.id);
  // Último cambio intentado: se puede reaplicar si hubo un conflicto de versión.
  const [lastChange, setLastChange] = useState<StatusChange | null>(null);
  const conflict = isVersionConflict(changeStatus.error) ? changeStatus.error.details.current : null;

  function apply(change: StatusChange, version = ticket.version) {
    setLastChange(change);
    return changeStatus.mutateAsync({ ...change, version }).then((result) => {
      toast.success(
        change.status === "closed"
          ? `${ticket.display_number} cerrado · ${closureReasonLabel[change.closure_reason ?? "resolved"]}`
          : `${ticket.display_number} pasó a En revisión`,
        { description: "El solicitante recibe el aviso." },
      );
      return result;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {conflict && lastChange && (
        <ConflictAlert
          current={conflict}
          pending={changeStatus.isPending}
          onRetry={() => void apply(lastChange, conflict.version).catch(() => undefined)}
          onDiscard={() => {
            setLastChange(null);
            changeStatus.reset();
          }}
        />
      )}
      {changeStatus.error && !conflict && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{changeStatus.error.message}</AlertDescription>
        </Alert>
      )}

      {ticket.permissions.can_change_status && (
        <div className="flex flex-wrap gap-2">
          {ticket.status === "open" && (
            <Button
              variant="outline"
              disabled={changeStatus.isPending}
              onClick={() => void apply({ status: "in_review" }).catch(() => undefined)}
            >
              <PlayIcon data-icon="inline-start" aria-hidden="true" />
              Pasar a En revisión
            </Button>
          )}
          <CloseDialog ticket={ticket} onSubmit={(change) => apply(change)} pending={changeStatus.isPending} />
        </div>
      )}

      {ticket.permissions.can_reopen && <ReopenDialog ticket={ticket} />}
    </div>
  );
}

function CloseDialog({
  ticket,
  onSubmit,
  pending,
}: {
  ticket: TicketDetail;
  onSubmit: (change: StatusChange) => Promise<unknown>;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ClosureReason>("resolved");
  const [summary, setSummary] = useState("");
  const [duplicateOf, setDuplicateOf] = useState("");
  const [error, setError] = useState("");
  const duplicate = reason === "duplicate";

  // Al abrir se limpia el error anterior; lo escrito se conserva (por si hubo un conflicto).
  function changeOpen(next: boolean) {
    if (next) setError("");
    setOpen(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const duplicateNumber = duplicate ? parseTicketNumber(duplicateOf) : null;
    if (duplicate && duplicateNumber === null) return setError("Indica el número del ticket original, por ejemplo TCK-000012.");
    if (!duplicate && summary.trim().length < 3)
      return setError(reason === "resolved" ? "Escribe el resumen de la resolución." : "Describe el motivo del cierre.");
    try {
      await onSubmit({
        status: "closed",
        closure_reason: reason,
        ...(summary.trim() ? { resolution_summary: summary.trim() } : {}),
        ...(duplicateNumber !== null ? { duplicate_of_number: duplicateNumber } : {}),
      });
      setOpen(false);
      setSummary("");
      setDuplicateOf("");
    } catch (failure) {
      // Un conflicto se muestra fuera del diálogo; el texto escrito se conserva.
      if (isVersionConflict(failure)) setOpen(false);
      else setError((failure as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button>
          <CheckCircle2Icon data-icon="inline-start" aria-hidden="true" />
          Cerrar ticket
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Cerrar {ticket.display_number}</DialogTitle>
            <DialogDescription>
              El solicitante verá el motivo y el resumen. Si el problema vuelve, podrá reabrir el ticket.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="closure-reason">Motivo</FieldLabel>
              <Select value={reason} onValueChange={(value) => setReason(value as ClosureReason)}>
                <SelectTrigger id="closure-reason" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {CLOSURE_REASONS.map((code) => (
                      <SelectItem key={code} value={code}>
                        {closureReasonLabel[code]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {duplicate && (
              <Field>
                <FieldLabel htmlFor="duplicate-of">Ticket original</FieldLabel>
                <Input
                  id="duplicate-of"
                  value={duplicateOf}
                  onChange={(e) => setDuplicateOf(e.target.value)}
                  placeholder="TCK-000012"
                />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="resolution-summary">
                {reason === "resolved" ? "Resumen de la resolución" : duplicate ? "Comentario (opcional)" : "Motivo del cierre"}
              </FieldLabel>
              <Textarea
                id="resolution-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={4}
                maxLength={4000}
                placeholder={reason === "resolved" ? "Qué se hizo y cómo se verificó" : "Explica brevemente el motivo"}
              />
              <FieldDescription>Una sugerencia de la IA no basta para cerrar: describe lo que se confirmó.</FieldDescription>
            </Field>
          </FieldGroup>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner aria-label="Guardando" data-icon="inline-start" />}
              Cerrar ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReopenDialog({ ticket }: { ticket: TicketDetail }) {
  const reopen = useReopen(ticket.id);
  const key = useIdempotencyKey();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const conflict = isVersionConflict(reopen.error) ? reopen.error.details.current : null;

  function submit(event?: FormEvent, version = ticket.version) {
    event?.preventDefault();
    if (reason.trim().length < 3) return;
    reopen.mutate(
      { body: { version, reason: reason.trim() }, idempotencyKey: key.current() },
      {
        onSuccess: () => {
          key.reset();
          setReason("");
          setOpen(false);
          toast.success(`${ticket.display_number} reabierto`, { description: "El historial se conserva y el equipo recibe el aviso." });
        },
        // Con otra versión la solicitud cambia: se necesita una clave nueva.
        // Ante un error de red se conserva la clave para que el reintento no duplique.
        onError: (error) => {
          if (isVersionConflict(error)) key.reset();
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
          Reabrir ticket
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Reabrir {ticket.display_number}</DialogTitle>
            <DialogDescription>El ticket vuelve a Abierto y se conserva todo el historial.</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="reopen-reason">¿Qué pasó?</FieldLabel>
            <Textarea
              id="reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Por ejemplo: el error volvió a aparecer hoy al exportar."
            />
          </Field>
          {conflict && (
            <ConflictAlert
              current={conflict}
              pending={reopen.isPending}
              onRetry={() => submit(undefined, conflict.version)}
              onDiscard={() => {
                reopen.reset();
                setOpen(false);
              }}
            />
          )}
          {reopen.error && !conflict && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{reopen.error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={reopen.isPending || reason.trim().length < 3}>
              {reopen.isPending && <Spinner aria-label="Reabriendo" data-icon="inline-start" />}
              Reabrir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
