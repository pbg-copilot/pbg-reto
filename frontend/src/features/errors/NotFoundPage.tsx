import { Link } from "react-router";
import { Button } from "@/components/ui/button";

export function NotFoundPage({ message = "No encontramos esta página o no tienes acceso a ella." }: { message?: string }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <span className="eyebrow">Error 404</span>
      <h1 className="text-3xl font-bold tracking-tight">Página no disponible</h1>
      <p className="text-muted-foreground">{message}</p>
      <Button asChild variant="outline">
        <Link to="/">Volver al inicio</Link>
      </Button>
    </div>
  );
}
