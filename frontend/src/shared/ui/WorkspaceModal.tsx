import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { WorkspaceNotificationContext } from "./workspace-notification";
import { useDialogGeometry } from "./useDialogGeometry";

export type WorkspaceModule = "chat" | "consultas" | "agenda" | "ficha";

type WorkspaceModalProps = {
  activeModule: WorkspaceModule;
  onModuleChange: (module: WorkspaceModule) => void;
  onClose: () => void;
  title: string;
  canManageAppointments: boolean;
  open: boolean;
  children: ReactNode;
  notification?: ReactNode;
};

const modules: { id: WorkspaceModule; label: string; icon: string }[] = [
  { id: "chat", label: "Chat PBG", icon: "◌" },
  { id: "consultas", label: "Consultas", icon: "⌕" },
  { id: "agenda", label: "Agenda", icon: "▦" },
];

export function WorkspaceModal({ activeModule, onModuleChange, onClose, title, canManageAppointments, open, children, notification }: WorkspaceModalProps) {
  const { dialogRef, backdropRef, geometryStyle, moving, resizing, resetGeometry, headerProps, moveHandleProps, resizeHandleProps } = useDialogGeometry(open);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const notificationCloseRef = useRef<HTMLButtonElement | null>(null);
  const [notificationCloseButton, setNotificationCloseButton] = useState<HTMLButtonElement | null>(null);
  const registerNotificationClose = useCallback((button: HTMLButtonElement) => {
    notificationCloseRef.current = button;
    setNotificationCloseButton(button);
    return () => {
      if (notificationCloseRef.current !== button) return;
      notificationCloseRef.current = null;
      setNotificationCloseButton(null);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = closeButtonRef.current?.closest("[role='dialog']");
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"))
        .filter((element) => !element.matches(":disabled") && element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => { document.removeEventListener("keydown", trapFocus); previouslyFocused?.focus(); };
  }, [open]);
  useEffect(() => {
    if (open) (notificationCloseRef.current ?? closeButtonRef.current)?.focus();
  }, [open, notificationCloseButton]);
  return (
    <div ref={backdropRef} className="workspace-modal-backdrop" data-moving={moving || undefined} data-resizing={resizing || undefined} hidden={!open} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} style={geometryStyle} className="workspace-modal" role="dialog" aria-modal="true" aria-label="Chat PBG">
        <header className="workspace-modal-header" {...headerProps}>
          <div className="modal-brand"><button type="button" className="modal-brand-mark modal-move-handle" aria-label="Mover Chat PBG" title="Arrastra la cabecera para mover. Con este botón enfocado, usa las flechas; Shift aumenta el paso e Inicio restablece tamaño y posición." {...moveHandleProps}>⠿</button><div><strong>Chat PBG</strong><small>{title}</small></div></div>
          <nav className="workspace-submenu" aria-label="Herramientas del espacio">
            <button type="button" className="home-nav-button" onClick={onClose}><span aria-hidden="true">⌂</span>Home</button>
            {modules.filter((module) => module.id !== "agenda" || canManageAppointments).map((module) => <button key={module.id} type="button" className={activeModule === module.id ? "active" : ""} aria-current={activeModule === module.id ? "page" : undefined} onClick={() => onModuleChange(module.id)}><span aria-hidden="true">{module.icon}</span>{module.label}</button>)}
          </nav>
          <button ref={closeButtonRef} className="modal-close" type="button" aria-label="Cerrar Chat PBG" onClick={onClose} disabled={Boolean(notificationCloseButton)} aria-hidden={notificationCloseButton ? true : undefined} tabIndex={notificationCloseButton ? -1 : undefined}>×</button>
        </header>
        <div className="workspace-modal-body" aria-label={moduleLabel(activeModule)}>{children}</div>
        <WorkspaceNotificationContext.Provider value={registerNotificationClose}>
          {notification}
        </WorkspaceNotificationContext.Provider>
        <footer className="workspace-modal-footer">
          <button type="button" className="modal-reset-size" onClick={resetGeometry}>Restablecer ventana</button>
          <span>Arrastra la cabecera para mover o la esquina para redimensionar</span>
          <button type="button" className="modal-resize-handle" aria-label="Redimensionar Chat PBG" title="Arrastra para redimensionar. Con el teclado, usa las flechas; Shift para pasos mayores e Inicio para restablecer tamaño y posición." {...resizeHandleProps}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M4 14 14 4M9 14l5-5M14 14h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </footer>
      </section>
    </div>
  );
}

function moduleLabel(module: WorkspaceModule) {
  if (module === "ficha") return "Su ficha";
  return modules.find((item) => item.id === module)?.label ?? "Chat";
}
