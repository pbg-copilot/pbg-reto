import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { BotIcon } from "lucide-react";
import { IMPACTS, impactLabel, type Impact } from "@reto/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ApiError } from "@/lib/api";
import { useIdempotencyKey } from "@/lib/idempotency";
import { useCategories, useCreateTicket } from "./api";

// Formulario manual: funciona aunque el asistente de IA no esté disponible.
export function NewTicketPage() {
  const navigate = useNavigate();
  const categories = useCategories();
  const create = useCreateTicket();
  const key = useIdempotencyKey();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [impact, setImpact] = useState<Impact>("medium");

  useEffect(() => {
    document.title = "RETO · Nuevo ticket";
  }, []);

  const fieldErrors = (create.error instanceof ApiError ? create.error.details?.fields : undefined) as
    | Record<string, string>
    | undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    // La clave se conserva mientras no haya éxito: reintentar o hacer doble clic no duplica.
    create.mutate(
      { body: { title, description, category, impact }, idempotencyKey: key.current() },
      {
        onSuccess: (ticket) => {
          key.reset();
          navigate(`/tickets/${ticket.id}`);
        },
      },
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <span className="eyebrow text-primary">Soporte</span>
        <h1 className="text-3xl font-bold tracking-tight">Nuevo ticket</h1>
        <p className="text-muted-foreground">Cuéntale al equipo qué pasa. Te avisaremos cada vez que el caso avance.</p>
      </div>

      {/* Sugerencia, no un error: role="note" para que no se anuncie como alerta. */}
      <Alert className="glass" role="note">
        <BotIcon aria-hidden="true" />
        <AlertDescription>
          ¿Quieres probar primero una solución conocida?{" "}
          <Link to="/soporte" className="font-medium underline">
            Habla con el asistente
          </Link>
          .
        </AlertDescription>
      </Alert>

      <Card className="glass">
        <CardHeader>
          <CardTitle>Datos del problema</CardTitle>
          <CardDescription>No incluyas contraseñas ni códigos de acceso.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={fieldErrors?.title ? true : undefined}>
                <FieldLabel htmlFor="title">Título</FieldLabel>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  minLength={3}
                  maxLength={160}
                  placeholder="Ej.: No puedo exportar el reporte de ventas"
                  aria-invalid={fieldErrors?.title ? true : undefined}
                />
                {fieldErrors?.title && <FieldError>{fieldErrors.title}</FieldError>}
              </Field>
              <Field data-invalid={fieldErrors?.description ? true : undefined}>
                <FieldLabel htmlFor="description">Descripción</FieldLabel>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  minLength={10}
                  maxLength={10000}
                  rows={6}
                  placeholder="Qué intentabas hacer, qué esperabas y qué pasó (mensaje de error, pantalla, hora aproximada)."
                  aria-invalid={fieldErrors?.description ? true : undefined}
                />
                <FieldDescription>Mínimo 10 caracteres.</FieldDescription>
              </Field>
              <Field data-invalid={fieldErrors?.category ? true : undefined}>
                <FieldLabel htmlFor="category">Categoría</FieldLabel>
                <Select value={category} onValueChange={setCategory} required>
                  <SelectTrigger id="category" className="w-full" aria-invalid={fieldErrors?.category ? true : undefined}>
                    <SelectValue placeholder="Elige una categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(categories.data ?? []).map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel id="impact-label">¿Cuánto te afecta?</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={impact}
                  onValueChange={(value) => value && setImpact(value as Impact)}
                  aria-labelledby="impact-label"
                  className="flex-wrap"
                >
                  {IMPACTS.map((level) => (
                    <ToggleGroupItem key={level} value={level}>
                      {impactLabel[level]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <FieldDescription>Crítico: no puedes trabajar. Bajo: es una molestia.</FieldDescription>
              </Field>
              {create.error && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{create.error.message}</AlertDescription>
                </Alert>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" asChild>
                  <Link to="/tickets">Cancelar</Link>
                </Button>
                <Button type="submit" disabled={create.isPending || !category}>
                  {create.isPending && <Spinner aria-label="Creando" data-icon="inline-start" />}
                  Crear ticket
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
