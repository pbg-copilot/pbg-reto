import { useCallback, useRef } from "react";

export const newIdempotencyKey = () => crypto.randomUUID();

// Una clave por intención: se conserva entre reintentos y se renueva al tener éxito.
export function useIdempotencyKey() {
  const key = useRef<string | null>(null);
  const current = useCallback(() => (key.current ??= newIdempotencyKey()), []);
  const reset = useCallback(() => {
    key.current = null;
  }, []);
  return { current, reset };
}
