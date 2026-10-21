import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ArrowLeftIcon } from "lucide-react";
import { INCIDENT_STATUSES, incidentStatusLabel, type IncidentStatus } from "@reto/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/format";
import { useCatalogNames } from "@/features/tickets/useCatalogNames";
import { useIncidents, useSaveIncident } from "./api";
import { IncidentStatusBadge } from "./components";

// Incidentes conocidos: el chat informa su estado público y vincula los tickets nuevos.
export function IncidentsPage() {
  const incidents = useIncidents(false);
  const save = useSaveIncident();
  const names = useCatalogNames();
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    document.title = "RETO · Incidentes";
  }, []);

  function create(event: FormEvent) {
    event.preventDefault();
    save.mutate(
      { body: { title, public_summary: summary, status: "investigating", category: category || null } },
      {
        onSuccess: () => {
          setTitle("");
          setSummary("");
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="self-start">
        <Link to="/admin/catalogo">
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          Catálogo
        </Link>
      </Button>
      <div className="flex flex-col gap-1">
        <span className="eyebrow text-primary">Estado del servicio</span>
        <h1 className="text-3xl font-bold tracking-tight">Incidentes conocidos</h1>
        <p className="text-muted-foreground">
          El resumen público lo ve cualquier usuario en el chat. Los tickets vinculados solo los ve el equipo.
        </p>
      </div>

      {save.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{save.error.message}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-3">
          {(incidents.data ?? []).map((incident) => (
            <Card key={incident.id} className="glass">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {incident.title}
                  <IncidentStatusBadge status={incident.status} />
                </CardTitle>
                <CardDescription>
                  Desde {formatRelative(incident.started_at)} · {incident.linked_tickets ?? 0} tickets vinculados
                  {incident.article && (
                    <>
                      {" · "}
                      <Link to={`/soporte/articulos/${incident.article.slug}`} className="underline">
                        {incident.article.title}
                      </Link>
                    </>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-end justify-between gap-3">
                <p className="max-w-prose text-sm">{incident.public_summary}</p>
                <Field className="w-52">
                  <FieldLabel htmlFor={`status-${incident.id}`}>Estado</FieldLabel>
                  <Select
                    value={incident.status}
                    onValueChange={(status) => save.mutate({ id: incident.id, body: { status: status as IncidentStatus } })}
                  >
                    <SelectTrigger id={`status-${incident.id}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {INCIDENT_STATUSES.map((code) => (
                          <SelectItem key={code} value={code}>
                            {incidentStatusLabel[code]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </CardContent>
            </Card>
          ))}
          {incidents.data?.length === 0 && <p className="text-sm text-muted-foreground">No hay incidentes registrados.</p>}
        </div>

        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">Registrar incidente</CardTitle>
            <CardDescription>No incluyas datos de usuarios: el resumen es público.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="i-title">Título</FieldLabel>
                  <Input id="i-title" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="i-summary">Resumen público</FieldLabel>
                  <Textarea id="i-summary" value={summary} onChange={(e) => setSummary(e.target.value)} required minLength={3} rows={4} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="i-category">Categoría</FieldLabel>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="i-category" className="w-full">
                      <SelectValue placeholder="Opcional" />
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
                <Button type="submit" disabled={save.isPending}>
                  Registrar
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
