import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AlertTriangleIcon, PlusIcon, SearchIcon, SirenIcon } from "lucide-react";
import { articleStatusLabel, type ArticleStatus } from "@reto/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCatalogNames } from "@/features/tickets/useCatalogNames";
import { useArticles } from "./api";
import { ArticleStatusBadge } from "./components";

const ALL = "__all";
const REVIEW_DAYS = 90;
const staleReview = (reviewedAt: string) => Date.now() - new Date(`${reviewedAt}T00:00:00`).getTime() > REVIEW_DAYS * 86_400_000;

export function AdminCatalogPage() {
  const [params, setParams] = useSearchParams();
  const names = useCatalogNames();
  const status = params.get("status") ?? ALL;
  const category = params.get("category") ?? ALL;
  const [search, setSearch] = useState(params.get("q") ?? "");
  const articles = useArticles({
    q: params.get("q") ?? undefined,
    status: status === ALL ? undefined : status,
    category: category === ALL ? undefined : category,
    page_size: "50",
  });

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === ALL) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if ((params.get("q") ?? "") !== search.trim()) update("q", search.trim());
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo reacciona al texto escrito
  }, [search]);

  useEffect(() => {
    document.title = "RETO · Catálogo";
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="eyebrow text-primary">Base de conocimiento</span>
          <h1 className="text-3xl font-bold tracking-tight">Catálogo de problemas conocidos</h1>
          <p className="text-muted-foreground">El asistente solo usa artículos publicados y vigentes.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/admin/incidentes">
              <SirenIcon data-icon="inline-start" aria-hidden="true" />
              Incidentes
            </Link>
          </Button>
          <Button asChild>
            <Link to="/admin/catalogo/nuevo">
              <PlusIcon data-icon="inline-start" aria-hidden="true" />
              Nuevo artículo
            </Link>
          </Button>
        </div>
      </div>

      <Tabs value={status} onValueChange={(value) => update("status", value)}>
        <TabsList>
          <TabsTrigger value={ALL}>Todos</TabsTrigger>
          {(Object.keys(articleStatusLabel) as ArticleStatus[]).map((code) => (
            <TabsTrigger key={code} value={code}>
              {articleStatusLabel[code]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <Label htmlFor="article-search">Buscar</Label>
          <InputGroup className="h-9">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              id="article-search"
              type="search"
              placeholder="Síntoma, título o etiqueta"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="article-category">Categoría</Label>
          <Select value={category} onValueChange={(value) => update("category", value)}>
            <SelectTrigger id="article-category" className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL}>Todas</SelectItem>
                {names.categories.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>

      {articles.isError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{articles.error.message}</AlertDescription>
        </Alert>
      )}
      {articles.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="glass overflow-x-auto rounded-xl">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Artículo</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Versión</TableHead>
                <TableHead>Revisado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(articles.data?.items ?? []).map((article) => (
                <TableRow key={article.id}>
                  <TableCell className="max-w-md">
                    <Link to={`/admin/catalogo/${article.id}`} className="font-medium hover:underline">
                      {article.title}
                    </Link>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {article.is_example && <Badge variant="outline" className="border-gold/40 text-gold-foreground">Ejemplo</Badge>}
                      {article.tags.slice(0, 3).map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{names.categoryName(article.category)}</TableCell>
                  <TableCell>
                    <ArticleStatusBadge status={article.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {article.published_version ? `v${article.published_version} publicada` : "Sin publicar"}
                    {article.latest_version !== article.published_version && ` · v${article.latest_version} última`}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="flex items-center gap-1">
                      {article.reviewed_at}
                      {staleReview(article.reviewed_at) && (
                        <AlertTriangleIcon className="size-4 text-gold" aria-label={`Revisión con más de ${REVIEW_DAYS} días`} />
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {articles.data?.items.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">No hay artículos con estos filtros.</p>
          )}
        </div>
      )}
    </div>
  );
}
