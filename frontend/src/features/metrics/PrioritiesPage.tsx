import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ArrowLeftIcon } from "lucide-react";
import type { Priority } from "@reto/shared";
import { toast } from "@/components/feedback/toast-store";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { usePriorities } from "@/features/tickets/api";
import { formatMinutesTarget, useUpdatePriority } from "./api";

// Objetivos de atención por prioridad (AC-007.3). Opcionales: sin objetivo no hay cumplimiento.
export function PrioritiesPage() {
  const priorities = usePriorities();

  useEffect(() => {
    document.title = "RETO · Prioridades";
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="self-start">
        <Link to="/admin/metricas">
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          Métricas
        </Link>
      </Button>
      <div className="flex flex-col gap-1">
        <span className="eyebrow text-primary">Configuración</span>
        <h1 className="text-3xl font-bold tracking-tight">Prioridades y objetivos</h1>
        <p className="text-muted-foreground">
          Objetivos internos del equipo, en horas. El solicitante nunca ve objetivos ni plazos. Dejar vacío quita el objetivo.
        </p>
      </div>
      {priorities.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(priorities.data ?? []).map((priority) => (
            <PriorityCard key={priority.code} priority={priority} />
          ))}
        </div>
      )}
    </div>
  );
}

const toHours = (minutes: number | null | undefined) => (minutes ? String(Math.round((minutes / 60) * 100) / 100) : "");
const toMinutes = (hours: string) => (hours.trim() === "" ? null : Math.round(Number(hours) * 60));

function PriorityCard({ priority }: { priority: Priority }) {
  const update = useUpdatePriority();
  const [firstResponse, setFirstResponse] = useState(toHours(priority.first_response_target_minutes));
  const [resolution, setResolution] = useState(toHours(priority.resolution_target_minutes));
  const invalid = [firstResponse, resolution].some((value) => value.trim() !== "" && !(Number(value) > 0));

  function save(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    update.mutate(
      {
        code: priority.code,
        body: { first_response_target_minutes: toMinutes(firstResponse), resolution_target_minutes: toMinutes(resolution) },
      },
      { onSuccess: () => toast.success(`Objetivos de «${priority.name}» guardados`) },
    );
  }

  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">{priority.name}</CardTitle>
        <CardDescription>
          Actual: primera respuesta {formatMinutesTarget(priority.first_response_target_minutes) ?? "sin objetivo"} · resolución{" "}
          {formatMinutesTarget(priority.resolution_target_minutes) ?? "sin objetivo"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`frt-${priority.code}`}>Primera respuesta (horas)</FieldLabel>
              <Input id={`frt-${priority.code}`} inputMode="decimal" value={firstResponse} onChange={(e) => setFirstResponse(e.target.value)} placeholder="Sin objetivo" />
            </Field>
            <Field>
              <FieldLabel htmlFor={`rt-${priority.code}`}>Resolución (horas)</FieldLabel>
              <Input id={`rt-${priority.code}`} inputMode="decimal" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="Sin objetivo" />
            </Field>
          </div>
          {invalid && <FieldDescription className="text-destructive">Usa un número de horas mayor que cero, por ejemplo 0.5 o 24.</FieldDescription>}
          {update.error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{update.error.message}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" variant="outline" className="self-start" disabled={update.isPending || invalid}>
            Guardar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
