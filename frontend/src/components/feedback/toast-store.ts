import { useSyncExternalStore } from "react";

// Avisos breves de "se hizo algo". Store mínimo fuera de React: se puede llamar a
// toast.success() desde cualquier callback (por ejemplo, onSuccess de una mutación).

export type ToastVariant = "success" | "error" | "info";
export type ToastItem = {
  id: number;
  variant: ToastVariant;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
};
type Options = Pick<ToastItem, "description" | "action">;

const MAX_VISIBLE = 3;
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function push(variant: ToastVariant, title: string, options: Options = {}) {
  const item: ToastItem = { id: nextId++, variant, title, ...options };
  items = [...items, item].slice(-MAX_VISIBLE);
  emit();
  return item.id;
}

export const toast = {
  success: (title: string, options?: Options) => push("success", title, options),
  error: (title: string, options?: Options) => push("error", title, options),
  info: (title: string, options?: Options) => push("info", title, options),
  dismiss(id: number) {
    items = items.filter((item) => item.id !== id);
    emit();
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useToasts = () => useSyncExternalStore(subscribe, () => items);
