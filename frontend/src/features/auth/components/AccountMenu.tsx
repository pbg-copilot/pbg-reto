import { useEffect, useRef, useState } from "react";
import type { Agent } from "../../../shared/types/domain";
import { Chevron, LogoutIcon } from "../../../shared/ui/ui";

type Props = { agent: Agent; busy: boolean; modalOpen: boolean; onLogout: () => Promise<boolean> };

export function AccountMenu({ agent, busy, modalOpen, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open && !modalOpen) { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, modalOpen]);

  async function logout() { if (await onLogout()) setOpen(false); }
  return <div className="account" ref={menuRef}>
    <div className="agent-label"><span className="eyebrow">AGENTE</span><span data-testid="agent-name">{agent.name}</span></div>
    <button ref={buttonRef} className="account-toggle" aria-label="Menú de cuenta" aria-expanded={open}
      aria-haspopup="menu" onClick={() => setOpen(!open)}>
      <span className="avatar">{agent.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><Chevron />
    </button>
    {open && <div className="account-menu" role="menu"><button role="menuitem" onClick={() => void logout()} disabled={busy}>
      <LogoutIcon />{busy ? "Cerrando sesión…" : "Logout"}
    </button></div>}
  </div>;
}
