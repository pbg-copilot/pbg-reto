import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { fitDialogRect, resizeDialogRect, type DialogBounds, type DialogRect } from "./dialog-geometry";

type Mode = "move" | "resize";
type Session = { mode: Mode; pointerId: number; x: number; y: number; rect: DialogRect; handle: HTMLElement };
const interactiveElements = "button, a, input, select, textarea, nav, [role='button'], [contenteditable]";

export function useDialogGeometry(open: boolean) {
  const dialogRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const [rect, setRect] = useState<DialogRect | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);

  const getBounds = useCallback((): DialogBounds => {
    const backdrop = backdropRef.current!;
    const padding = getComputedStyle(backdrop);
    const left = parseFloat(padding.paddingLeft);
    const top = parseFloat(padding.paddingTop);
    return {
      left, top,
      width: Math.max(0, backdrop.clientWidth - left - parseFloat(padding.paddingRight)),
      height: Math.max(0, backdrop.clientHeight - top - parseFloat(padding.paddingBottom)),
    };
  }, []);

  function readRect(): DialogRect {
    const dialog = dialogRef.current!.getBoundingClientRect();
    const backdrop = backdropRef.current!.getBoundingClientRect();
    return { left: dialog.left - backdrop.left, top: dialog.top - backdrop.top, width: dialog.width, height: dialog.height };
  }

  const finish = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    setMode(null);
  }, []);

  useEffect(() => {
    if (!open) { finish(); return; }
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    const observer = new ResizeObserver(() => {
      const bounds = getBounds();
      // Closing hides the backdrop before passive effects disconnect the observer.
      if (bounds.width === 0 || bounds.height === 0) return;
      setRect((current) => current ? fitDialogRect(current, bounds) : null);
    });
    observer.observe(backdrop);
    return () => observer.disconnect();
  }, [open, finish, getBounds]);

  function start(nextMode: Mode, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || session.current || !dialogRef.current || !backdropRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget instanceof HTMLButtonElement) event.currentTarget.focus();
    const current = fitDialogRect(readRect(), getBounds());
    session.current = { mode: nextMode, pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect: current, handle: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    setRect(current);
    setMode(nextMode);
  }

  function update(event: PointerEvent<HTMLElement>) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const bounds = getBounds();
    if (bounds.width === 0 || bounds.height === 0) { finish(); return; }
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    setRect(current.mode === "move"
      ? fitDialogRect({ ...current.rect, left: current.rect.left + dx, top: current.rect.top + dy }, bounds)
      : resizeDialogRect(current.rect, current.rect.width + dx, current.rect.height + dy, bounds));
  }

  function end(event: PointerEvent<HTMLElement>) {
    if (session.current?.pointerId === event.pointerId) finish();
  }

  function reset() { finish(); setRect(null); }

  function withKeyboard(nextMode: Mode, event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Home") { event.preventDefault(); reset(); return; }
    const step = event.shiftKey ? 60 : 20;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -step;
    else if (event.key === "ArrowRight") dx = step;
    else if (event.key === "ArrowUp") dy = -step;
    else if (event.key === "ArrowDown") dy = step;
    else return;
    if (!dialogRef.current || !backdropRef.current) return;
    event.preventDefault();
    const current = readRect();
    setRect(nextMode === "move"
      ? fitDialogRect({ ...current, left: current.left + dx, top: current.top + dy }, getBounds())
      : resizeDialogRect(current, current.width + dx, current.height + dy, getBounds()));
  }

  const geometryStyle: CSSProperties | undefined = rect ? {
    position: "absolute", left: rect.left, top: rect.top, width: rect.width, height: rect.height,
    minWidth: 0, minHeight: 0,
    maxWidth: "calc(100% - 2 * var(--workspace-edge))", maxHeight: "calc(100% - 2 * var(--workspace-edge))",
  } : undefined;
  const pointerEvents = { onPointerMove: update, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end };

  return {
    dialogRef, backdropRef, geometryStyle, moving: mode === "move", resizing: mode === "resize", resetGeometry: reset,
    headerProps: {
      ...pointerEvents,
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.target instanceof Element && !event.target.closest(interactiveElements)) start("move", event);
      },
    },
    moveHandleProps: {
      onPointerDown: (event: PointerEvent<HTMLElement>) => start("move", event),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => withKeyboard("move", event),
    },
    resizeHandleProps: {
      ...pointerEvents,
      onPointerDown: (event: PointerEvent<HTMLElement>) => start("resize", event),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => withKeyboard("resize", event),
    },
  };
}
