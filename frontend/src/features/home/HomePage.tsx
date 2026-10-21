import { useEffect } from "react";
import { Link, useOutletContext } from "react-router";
import { ArrowRightIcon, LifeBuoyIcon, TicketIcon } from "lucide-react";
import type { Agent } from "@reto/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function HomePage() {
  const agent = useOutletContext<Agent>();
  const firstName = agent.name.split(/\s+/)[0];

  useEffect(() => {
    document.title = "RETO · Inicio";
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="eyebrow text-primary">Tu espacio de trabajo</span>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Hola, {firstName}.</h1>
        <p className="text-muted-foreground">¿En qué te ayudamos hoy?</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="glass">
          <CardHeader>
            <LifeBuoyIcon aria-hidden="true" className="size-6 text-brand" />
            <CardTitle>Soporte</CardTitle>
            <CardDescription>
              Describe tu problema al asistente. Si no hay una solución conocida, crea un ticket por ti.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link to="/soporte">
                Ir a soporte
                <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
              </Link>
            </Button>
          </CardFooter>
        </Card>
        <Card className="glass">
          <CardHeader>
            <TicketIcon aria-hidden="true" className="size-6 text-brand" />
            <CardTitle>Mis tickets</CardTitle>
            <CardDescription>Revisa el estado de tus casos, responde al equipo o reabre un ticket.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" asChild>
              <Link to="/tickets">Ver mis tickets</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Card className="glass">
        <CardContent className="grid gap-6 sm:grid-cols-3">
          <Detail label="Agente" value={agent.name} />
          <Detail label="Organización" value={agent.agency_name || "Independiente"} />
          <div className="flex flex-col gap-1">
            <span className="eyebrow">Entorno</span>
            <span>
              <Badge variant="secondary">Prueba · Copia de PostgreSQL</Badge>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="eyebrow">{label}</span>
      <strong className="truncate font-semibold">{value}</strong>
    </div>
  );
}
