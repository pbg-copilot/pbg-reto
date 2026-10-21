import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

// Paginación numérica para listas que pueden crecer (tickets, catálogo, notificaciones,
// incidentes). Con keepPreviousData la página actual sigue visible mientras llega la otra.
export function Pager({
  page,
  pageSize,
  total,
  noun,
  onPageChange,
  loading = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: [singular: string, plural: string];
  onPageChange: (page: number) => void;
  loading?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        {loading && <Spinner aria-hidden="true" className="size-3.5" />}
        {from}–{to} de {total} {total === 1 ? noun[0] : noun[1]}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>
            <ChevronLeftIcon data-icon="inline-start" aria-hidden="true" />
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages || loading} onClick={() => onPageChange(page + 1)}>
            Siguiente
            <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
        </div>
      )}
    </nav>
  );
}
