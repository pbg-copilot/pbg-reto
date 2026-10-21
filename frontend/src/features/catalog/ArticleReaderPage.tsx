import { useEffect, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ArrowLeftIcon, FlaskConicalIcon, InfoIcon } from "lucide-react";
import { EXAMPLE_NOTICE } from "@reto/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/Markdown";
import { ApiError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { NotFoundPage } from "@/features/errors/NotFoundPage";
import { useCatalogNames } from "@/features/tickets/useCatalogNames";
import { useArticleReader } from "./api";

// Lectura de un artículo desde el chat: instrucciones claras y salida al ticket si no funciona.
export function ArticleReaderPage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const v = params.get("v");
  const article = useArticleReader(slug, v ? Number(v) : undefined);
  const names = useCatalogNames();

  useEffect(() => {
    if (article.data) document.title = `RETO · ${article.data.version.title}`;
  }, [article.data]);

  if (article.error instanceof ApiError && article.error.status === 404)
    return <NotFoundPage message="Este artículo no existe o ya no está disponible." />;
  if (article.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{article.error.message}</AlertDescription>
      </Alert>
    );
  if (article.isPending)
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );

  const a = article.data;
  const version = a.version;

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="self-start">
        <Link to="/soporte">
          <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
          Volver al soporte
        </Link>
      </Button>
      <div className="flex flex-col gap-3">
        <span className="eyebrow text-primary">Artículo de ayuda · {names.categoryName(a.category)}</span>
        <h1 className="text-3xl font-bold tracking-tight">{version.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">Versión {version.version}</Badge>
          <span>Revisado el {version.reviewed_at}</span>
          {version.applies_to && <span>· Aplica a: {version.applies_to}</span>}
        </div>
      </div>

      {a.is_example && (
        <Alert role="note" className="border-gold/40 bg-gold-soft">
          <FlaskConicalIcon aria-hidden="true" />
          <AlertTitle>{EXAMPLE_NOTICE}</AlertTitle>
          <AlertDescription>Contenido ficticio para el entorno de prueba.</AlertDescription>
        </Alert>
      )}
      {!a.is_current && (
        <Alert role="note">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>
            Estás viendo una versión anterior
            {version.published_at ? ` (publicada el ${formatDateTime(version.published_at)})` : ""}.{" "}
            {a.status === "published" && (
              <Link to={`/soporte/articulos/${a.slug}`} className="font-medium underline">
                Ver la versión vigente
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Section title="Síntomas">
        <Markdown>{version.symptoms}</Markdown>
      </Section>
      <Section title="Antes de empezar: revisa">
        <Markdown>{version.diagnosis_steps}</Markdown>
      </Section>
      <Section title="Solución">
        <Markdown>{version.solution}</Markdown>
      </Section>
      <Section title="Cuándo pedir ayuda al equipo">
        <Markdown>{version.escalation_conditions}</Markdown>
      </Section>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/soporte">Esto no me resolvió: volver al chat</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/tickets/nuevo">Crear un ticket</Link>
        </Button>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="glass">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
