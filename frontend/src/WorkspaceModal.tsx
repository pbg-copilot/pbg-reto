import { useEffect, useRef, type ReactNode } from "react";

export type WorkspaceModule = "chat" | "consultas" | "agenda";

type WorkspaceModalProps = {
  activeModule: WorkspaceModule;
  onModuleChange: (module: WorkspaceModule) => void;
  onClose: () => void;
  title: string;
  canManageAppointments: boolean;
  open: boolean;
  children: ReactNode;
};

const modules: { id: WorkspaceModule; label: string; icon: string }[] = [
  { id: "chat", label: "Chat PBG", icon: "◌" },
  { id: "consultas", label: "Consultas", icon: "⌕" },
  { id: "agenda", label: "Agenda", icon: "▦" },
];

export function WorkspaceModal({ activeModule, onModuleChange, onClose, title, canManageAppointments, open, children }: WorkspaceModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = closeButtonRef.current?.closest("[role='dialog']");
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => { document.removeEventListener("keydown", trapFocus); previouslyFocused?.focus(); };
  }, [open]);
  return (
    <div className="workspace-modal-backdrop" hidden={!open} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="workspace-modal" role="dialog" aria-modal="true" aria-label="Chat PBG">
        <header className="workspace-modal-header">
          <div className="modal-brand"><span className="modal-brand-mark">P</span><div><strong>Chat PBG</strong><small>{title}</small></div></div>
          <nav className="workspace-submenu" aria-label="Herramientas del espacio">
            <button type="button" className="home-nav-button" onClick={onClose}><span aria-hidden="true">⌂</span>Home</button>
            {modules.filter((module) => module.id !== "agenda" || canManageAppointments).map((module) => <button key={module.id} type="button" className={activeModule === module.id ? "active" : ""} aria-current={activeModule === module.id ? "page" : undefined} onClick={() => onModuleChange(module.id)}><span aria-hidden="true">{module.icon}</span>{module.label}</button>)}
          </nav>
          <button ref={closeButtonRef} className="modal-close" type="button" aria-label="Cerrar Chat PBG" onClick={onClose}>×</button>
        </header>
        <div className="workspace-modal-body" aria-label={moduleLabel(activeModule)}>{children}</div>
      </section>
    </div>
  );
}

function moduleLabel(module: WorkspaceModule) {
  return modules.find((item) => item.id === module)?.label ?? "Chat";
}
