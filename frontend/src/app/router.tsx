import { createBrowserRouter, Outlet, useOutletContext } from "react-router";
import { isAdmin, type Agent } from "@reto/shared";
import { AppShell } from "./layout/AppShell";
import { HomePage } from "@/features/home/HomePage";
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
    // Mientras carga la primera pantalla diferida (evita el aviso de HydrateFallback).
    hydrateFallbackElement: <div className="min-h-dvh bg-background" aria-busy="true" />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: "soporte",
        lazy: async () => ({ Component: (await import("@/features/support/SupportPage")).SupportPage }),
      },
      {
        path: "soporte/c/:id",
        lazy: async () => ({ Component: (await import("@/features/support/SupportPage")).SupportPage }),
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
        path: "notificaciones",
        lazy: async () => ({ Component: (await import("@/features/notifications/NotificationsPage")).NotificationsPage }),
      },
      {
        path: "soporte/articulos/:slug",
        lazy: async () => ({ Component: (await import("@/features/catalog/ArticleReaderPage")).ArticleReaderPage }),
      },
      {
        path: "admin",
        element: <RequireAdmin />,
        children: [
          {
            path: "catalogo",
            lazy: async () => ({ Component: (await import("@/features/catalog/AdminCatalogPage")).AdminCatalogPage }),
          },
          {
            path: "catalogo/nuevo",
            lazy: async () => ({ Component: (await import("@/features/catalog/ArticleEditorPage")).ArticleEditorPage }),
          },
          {
            path: "catalogo/:id",
            lazy: async () => ({ Component: (await import("@/features/catalog/ArticleEditorPage")).ArticleEditorPage }),
          },
          {
            path: "incidentes",
            lazy: async () => ({ Component: (await import("@/features/catalog/IncidentsPage")).IncidentsPage }),
          },
          {
            path: "metricas",
            lazy: async () => ({ Component: (await import("@/features/metrics/MetricsPage")).MetricsPage }),
          },
          {
            path: "prioridades",
            lazy: async () => ({ Component: (await import("@/features/metrics/PrioritiesPage")).PrioritiesPage }),
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
