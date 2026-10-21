import { useEffect } from "react";
import { ConstructionIcon } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Pantallas que se completan en specs posteriores.
export function ComingSoon({ title, spec, description }: { title: string; spec: string; description: string }) {
  useEffect(() => {
    document.title = `RETO · ${title}`;
  }, [title]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <Card className="glass">
        <CardHeader>
          <ConstructionIcon aria-hidden="true" className="size-6 text-gold" />
          <CardTitle>En construcción</CardTitle>
          <CardDescription>
            {description} <span className="text-xs">({spec})</span>
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
