import { createBrowserRouter, Outlet, useOutletContext } from "react-router";
import { isAdmin, type Agent } from "@reto/shared";
import { AppShell } from "./layout/AppShell";
import { HomePage } from "@/features/home/HomePage";
import { ComingSoon } from "@/features/placeholder/ComingSoon";
import { NotFoundPage } from "@/features/errors/NotFoundPage";

// La API vuelve a verificar el rol; esto solo evita mostrar pantallas que no aplican.
function RequireAdmin() {
  const agent = useOutletContext<Agent>();
  if (!isAdmin(agent)) return <NotFoundPage />;
  return <Outlet context={agent} />;
}

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: "soporte",
        element: (
          <ComingSoon
            title="Soporte"
            spec="spec 004"
            description="Aquí estará el chat con el asistente y el acceso a tus tickets."
          />
        ),
      },
      // Carga diferida por ruta: cada pantalla se descarga al visitarla.
      {
        path: "tickets",
        lazy: async () => ({ Component: (await import("@/features/tickets/TicketsPage")).TicketsPage }),
      },
      {
        path: "tickets/nuevo",
        lazy: async () => ({ Component: (await import("@/features/tickets/NewTicketPage")).NewTicketPage }),
      },
      {
        path: "tickets/:id",
        lazy: async () => ({ Component: (await import("@/features/tickets/TicketDetailPage")).TicketDetailPage }),
      },
      {
        path: "admin",
        element: <RequireAdmin />,
        children: [
          {
            path: "catalogo",
            element: (
              <ComingSoon
                title="Catálogo"
                spec="spec 003"
                description="Gestión de artículos de problemas conocidos e incidentes."
              />
            ),
          },
          {
            path: "metricas",
            element: (
              <ComingSoon
                title="Métricas"
                spec="spec 007"
                description="Tiempos de primera respuesta, resolución y costo del asistente."
              />
            ),
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
