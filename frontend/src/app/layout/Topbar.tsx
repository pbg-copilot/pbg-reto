import { useState } from "react";
import { NavLink } from "react-router";
import { ChevronDownIcon, LogOutIcon, MoonIcon, SunIcon } from "lucide-react";
import { isAdmin, type Agent } from "@reto/shared";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Wordmark } from "@/components/brand/Wordmark";
import { useLogout } from "@/features/auth/useSession";
import { NotificationBell } from "@/features/notifications/NotificationBell";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; end?: boolean };

const requesterNav: NavItem[] = [
  { to: "/", label: "Inicio", end: true },
  { to: "/soporte", label: "Soporte" },
  { to: "/tickets", label: "Tickets" },
];
const adminNav: NavItem[] = [
  { to: "/admin/catalogo", label: "Catálogo" },
  { to: "/admin/metricas", label: "Métricas" },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export function Topbar({ agent }: { agent: Agent }) {
  const logout = useLogout();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const nav = isAdmin(agent) ? [...requesterNav, ...adminNav] : requesterNav;

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  return (
    <header className="glass sticky top-0 z-40 border-x-0 border-t-0">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <NavLink to="/" aria-label="RETO, inicio" className="shrink-0 rounded-md">
          <Wordmark />
        </NavLink>

        <nav aria-label="Principal" className="hidden md:block">
          <NavList items={nav} />
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <NotificationBell />
          <Button
            variant="ghost"
            size="icon"
            aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema oscuro"}
            onClick={toggleTheme}
          >
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </Button>

          <div className="hidden flex-col items-end leading-tight sm:flex">
            <span className="eyebrow">{isAdmin(agent) ? "Administrador" : "Agente"}</span>
            <span data-testid="agent-name" className="max-w-48 truncate text-sm font-medium">
              {agent.name}
            </span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-10 gap-1 rounded-full px-1" aria-label="Menú de cuenta">
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                    {initials(agent.name)}
                  </AvatarFallback>
                </Avatar>
                <ChevronDownIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={logout.isPending} onSelect={() => logout.mutate()}>
                  <LogOutIcon />
                  {logout.isPending ? "Cerrando sesión…" : "Logout"}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* En móvil la navegación pasa a una segunda fila desplazable. */}
      <nav aria-label="Principal móvil" className="overflow-x-auto border-t px-4 md:hidden">
        <NavList items={nav} />
      </nav>
    </header>
  );
}

function NavList({ items }: { items: NavItem[] }) {
  return (
    <ul className="flex items-center gap-1">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "inline-flex h-10 items-center rounded-full px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                isActive && "bg-accent text-foreground",
              )
            }
          >
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}
