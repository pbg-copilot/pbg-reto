import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArchiveIcon, ArrowLeftIcon, EyeIcon, SendIcon, Trash2Icon } from "lucide-react";
import type { ArticleManage, CreateArticleBody } from "@reto/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/Markdown";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useCatalogNames } from "@/features/tickets/useCatalogNames";
import { useArchive, useArticleManage, useCreateArticle, useDiscardArticle, useNewVersion, usePublish } from "./api";
import { ArticleStatusBadge } from "./components";
import { toast } from "@/components/feedback/toast-store";

type Form = Required<Omit<CreateArticleBody, "valid_until" | "tags" | "reviewed_at">> & {
  tags: string;
  reviewed_at: string;
  valid_until: string;
};

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY: Form = {
  title: "",
  category: "",
  symptoms: "",
  applies_to: "",
  diagnosis_steps: "",
  solution: "",
  escalation_conditions: "",
  tags: "",
  reviewed_at: today(),
  valid_until: "",
  is_example: false,
};

function fromArticle(article: ArticleManage): Form {
  const latest = article.versions[0]!;
  return {
    title: latest.title,
    category: article.category,
    symptoms: latest.symptoms,
    applies_to: latest.applies_to,
    diagnosis_steps: latest.diagnosis_steps,
    solution: latest.solution,
    escalation_conditions: latest.escalation_conditions,
    tags: latest.tags.join(", "),
    reviewed_at: today(),
    valid_until: latest.valid_until ?? "",
    is_example: article.is_example,
  };
}

export function ArticleEditorPage() {
  const { id } = useParams();
  const manage = useArticleManage(id);
  if (id && manage.isPending) return <Skeleton className="h-96 w-full" />;
  if (id && manage.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{manage.error.message}</AlertDescription>
      </Alert>
    );
  // La clave reinicia el formulario cuando se guarda una versión nueva.
  return <Editor key={`${id ?? "new"}:${manage.data?.latest_version ?? 0}`} article={manage.data} />;
}

function Editor({ article }: { article?: ArticleManage }) {
  const navigate = useNavigate();
  const names = useCatalogNames();
  const [form, setForm] = useState<Form>(() => (article ? fromArticle(article) : EMPTY));
  const create = useCreateArticle();
  const newVersion = useNewVersion(article?.id ?? "");
  const publish = usePublish(article?.id ?? "");
  const archive = useArchive(article?.id ?? "");
  const saving = create.isPending || newVersion.isPending;
  const error = create.error ?? newVersion.error ?? publish.error ?? archive.error;

  useEffect(() => {
    document.title = article ? `RETO · Editar ${article.title}` : "RETO · Nuevo artículo";
  }, [article]);

  const set = (key: keyof Form) => (value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      title: form.title,
      category: form.category,
      symptoms: form.symptoms,
      applies_to: form.applies_to,
      diagnosis_steps: form.diagnosis_steps,
      solution: form.solution,
      escalation_conditions: form.escalation_conditions,
      tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      reviewed_at: form.reviewed_at || undefined,
      valid_until: form.valid_until || null,
    };
    if (article)
      newVersion.mutate({ ...body, base_version: article.latest_version }, { onSuccess: () => toast.success("Nueva versión guardada como borrador") });
    else
      create.mutate(
        { ...body, is_example: form.is_example },
        {
          onSuccess: (created) => {
            toast.success("Borrador creado", { description: "Publícalo para que el asistente lo use." });
            navigate(`/admin/catalogo/${created.id}`);
          },
        },
      );
  }

  const conflict = error instanceof ApiError && error.code === "version_conflict";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Button variant="ghost" size="sm" asChild className="self-start">
          <Link to="/admin/catalogo">
            <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
            Catálogo
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{article ? article.title : "Nuevo artículo"}</h1>
          {article && <ArticleStatusBadge status={article.status} />}
          {article?.is_example && <Badge variant="outline" className="border-gold/40 text-gold-foreground">Ejemplo</Badge>}
        </div>
        {article?.source_ticket && (
          <p className="text-sm text-muted-foreground">
            Borrador creado desde{" "}
            <Link to={`/tickets/${article.source_ticket.id}`} className="underline">
              {article.source_ticket.display_number}
            </Link>
            . Revisa que no queden datos personales antes de publicar.
          </p>
        )}
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>{conflict ? "Otro administrador guardó una versión más nueva" : "No se pudo guardar"}</AlertTitle>
          <AlertDescription>
            {conflict ? "Recarga la página para ver la última versión; copia antes lo que escribiste." : error.message}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="text-base">{article ? `Nueva versión (v${article.latest_version + 1})` : "Contenido"}</CardTitle>
            <CardDescription>
              Las versiones son inmutables: guardar crea una nueva. La versión publicada no cambia hasta que publiques otra.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="edit">
              <TabsList>
                <TabsTrigger value="edit">Editar</TabsTrigger>
                <TabsTrigger value="preview">Vista previa</TabsTrigger>
              </TabsList>
              <TabsContent value="edit">
                <form onSubmit={submit} className="pt-4">
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="a-title">Título</FieldLabel>
                      <Input id="a-title" value={form.title} onChange={(e) => set("title")(e.target.value)} required minLength={3} maxLength={160} />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="a-category">Categoría</FieldLabel>
                        <Select value={form.category} onValueChange={set("category")}>
                          <SelectTrigger id="a-category" className="w-full">
                            <SelectValue placeholder="Elige una categoría" />
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
                        <FieldLabel htmlFor="a-applies">Plataforma o versión</FieldLabel>
                        <Input id="a-applies" value={form.applies_to} onChange={(e) => set("applies_to")(e.target.value)} maxLength={200} placeholder="Web, Chrome reciente…" />
                      </Field>
                    </div>
                    {(
                      [
                        ["symptoms", "Síntomas", "Cómo lo describe el usuario."],
                        ["diagnosis_steps", "Pasos de diagnóstico", "Markdown: listas numeradas."],
                        ["solution", "Solución", "Instrucciones claras y verificables."],
                        ["escalation_conditions", "Condiciones de escalación", "Cuándo crear un ticket."],
                      ] as const
                    ).map(([key, label, hint]) => (
                      <Field key={key}>
                        <FieldLabel htmlFor={`a-${key}`}>{label}</FieldLabel>
                        <Textarea id={`a-${key}`} value={form[key]} onChange={(e) => set(key)(e.target.value)} rows={key === "symptoms" ? 3 : 5} required />
                        <FieldDescription>{hint}</FieldDescription>
                      </Field>
                    ))}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field>
                        <FieldLabel htmlFor="a-tags">Etiquetas</FieldLabel>
                        <Input id="a-tags" value={form.tags} onChange={(e) => set("tags")(e.target.value)} placeholder="login, acceso" />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="a-reviewed">Fecha de revisión</FieldLabel>
                        <Input id="a-reviewed" type="date" value={form.reviewed_at} onChange={(e) => set("reviewed_at")(e.target.value)} />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="a-valid">Vigente hasta (opcional)</FieldLabel>
                        <Input id="a-valid" type="date" value={form.valid_until} onChange={(e) => set("valid_until")(e.target.value)} />
                      </Field>
                    </div>
                    {!article && (
                      <div className="flex items-center gap-2">
                        <Checkbox id="a-example" checked={form.is_example} onCheckedChange={(checked) => set("is_example")(checked === true)} />
                        <Label htmlFor="a-example">Marcar como ejemplo (no es un procedimiento oficial)</Label>
                      </div>
                    )}
                    <div className="flex justify-end">
                      <Button type="submit" disabled={saving || !form.category}>
                        {saving && <Spinner aria-label="Guardando" data-icon="inline-start" />}
                        {article ? "Guardar nueva versión" : "Crear borrador"}
                      </Button>
                    </div>
                  </FieldGroup>
                </form>
              </TabsContent>
              <TabsContent value="preview" className="flex flex-col gap-4 pt-4">
                <h2 className="text-xl font-bold">{form.title || "Sin título"}</h2>
                {(
                  [
                    ["Síntomas", form.symptoms],
                    ["Antes de empezar: revisa", form.diagnosis_steps],
                    ["Solución", form.solution],
                    ["Cuándo pedir ayuda al equipo", form.escalation_conditions],
                  ] as const
                ).map(([title, text]) => (
                  <section key={title} className="flex flex-col gap-1">
                    <h3 className="eyebrow">{title}</h3>
                    <Markdown>{text || "—"}</Markdown>
                  </section>
                ))}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {article && (
          <aside className="flex flex-col gap-6">
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base">Versiones</CardTitle>
                <CardDescription>El chat usa solo la versión publicada.</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="flex flex-col gap-3">
                  {article.versions.map((version) => {
                    const current = article.status === "published" && version.version === article.published_version;
                    return (
                      <li key={version.id} className="flex items-center justify-between gap-2 text-sm">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            v{version.version} {current && <Badge className="ml-1">Publicada</Badge>}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(version.created_at)}
                            {version.created_by ? ` · ${version.created_by}` : " · seed"}
                          </span>
                        </div>
                        {!current && (
                          <Button size="sm" variant="outline" disabled={publish.isPending} onClick={() => publish.mutate(version.id, { onSuccess: () => toast.success("Versión publicada", { description: "El asistente ya la usa." }) })}>
                            <SendIcon data-icon="inline-start" aria-hidden="true" />
                            Publicar
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
            <Card className="glass">
              <CardContent className="flex flex-col gap-2 pt-6">
                {article.published_version && (
                  <Button variant="outline" asChild>
                    <Link to={`/soporte/articulos/${article.slug}`}>
                      <EyeIcon data-icon="inline-start" aria-hidden="true" />
                      Ver como solicitante
                    </Link>
                  </Button>
                )}
                {article.status !== "archived" && article.versions.some((v) => v.published_at) && (
                  <Button variant="outline" disabled={archive.isPending} onClick={() => archive.mutate(undefined, { onSuccess: () => toast.success("Artículo archivado") })}>
                    <ArchiveIcon data-icon="inline-start" aria-hidden="true" />
                    Archivar (el chat deja de usarlo)
                  </Button>
                )}
                {/* Un borrador que nunca se publicó se puede descartar; lo publicado solo se archiva. */}
                {article.status === "draft" && !article.versions.some((v) => v.published_at) && <DiscardDraft articleId={article.id} />}
              </CardContent>
            </Card>
          </aside>
        )}
      </div>
    </div>
  );
}

function DiscardDraft({ articleId }: { articleId: string }) {
  const discard = useDiscardArticle(articleId);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-destructive">
          <Trash2Icon data-icon="inline-start" aria-hidden="true" />
          Descartar borrador
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Descartar este borrador?</DialogTitle>
          <DialogDescription>Nunca se publicó, así que el asistente no lo usó. Se borra con todas sus versiones.</DialogDescription>
        </DialogHeader>
        {discard.error && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{discard.error.message}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={discard.isPending}
            onClick={() =>
              discard.mutate(undefined, {
                onSuccess: () => {
                  toast.success("Borrador descartado");
                  navigate("/admin/catalogo?status=draft");
                },
              })
            }
          >
            Descartar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
