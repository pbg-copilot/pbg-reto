import { useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Estado de la conexión con el servidor (AC-007.21): cuándo llegaron los datos, si se están
// actualizando y si la última consulta falló (se siguen mostrando los últimos datos).
type QueryState = Pick<UseQueryResult, "dataUpdatedAt" | "isFetching" | "isError" | "refetch">;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const ago = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 10) return "hace un momento";
  if (seconds < 60) return `hace ${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `hace ${minutes} min` : `hace ${Math.round(minutes / 60)} h`;
};

export function LiveStatus({ query, live }: { query: QueryState; live?: string }) {
  const now = useNow(10_000);
  const updated = query.dataUpdatedAt ? ago(now - query.dataUpdatedAt) : null;
  const state = query.isError ? "error" : query.isFetching ? "fetching" : "ok";

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="live-status">
      <span
        aria-hidden="true"
        className={cn("size-2 rounded-full", state === "error" ? "bg-destructive" : state === "fetching" ? "animate-pulse bg-gold" : "bg-success")}
      />
      <span>
        {state === "error"
          ? `Sin conexión con el servidor${updated ? `; se muestran los datos de ${updated}` : ""}`
          : state === "fetching"
            ? "Actualizando…"
            : `Actualizado ${updated ?? "recién"}${live ? ` · ${live}` : ""}`}
      </span>
      {/* Solo se anuncia el cambio de estado, no cada actualización del reloj. */}
      <span className="sr-only" role="status">
        {state === "error" ? "Sin conexión con el servidor" : ""}
      </span>
      <Button variant="ghost" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
        <RefreshCwIcon data-icon="inline-start" aria-hidden="true" className={cn(query.isFetching && "animate-spin")} />
        Actualizar
      </Button>
    </div>
  );
}
