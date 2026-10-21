import { Outlet } from "react-router";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Wordmark } from "@/components/brand/Wordmark";
import { LoginPage } from "@/features/auth/LoginPage";
import { useSession } from "@/features/auth/useSession";
import { Topbar } from "./Topbar";

// Sin sesión se muestra el login en cualquier ruta; al entrar se conserva la URL.
export function AppShell() {
  const session = useSession();

  if (session.isPending)
    return (
      <div role="status" className="flex min-h-dvh flex-col items-center justify-center gap-4 text-muted-foreground">
        <Wordmark className="text-foreground" />
        <Spinner aria-label="Cargando" />
        Preparando tu espacio
      </div>
    );

  if (session.isError)
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <Wordmark />
        <p className="text-muted-foreground">No pudimos conectar. Intenta de nuevo.</p>
        <Button onClick={() => void session.refetch()}>Reintentar</Button>
      </div>
    );

  if (!session.data) return <LoginPage />;

  return (
    <div className="flex min-h-dvh flex-col">
      <Topbar agent={session.data} />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <Outlet context={session.data} />
      </main>
    </div>
  );
}
