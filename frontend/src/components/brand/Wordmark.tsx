import { cn } from "@/lib/utils";

// Wordmark de texto: no usamos el logo de PBG.
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-lg font-extrabold tracking-[0.2em]", className)}>
      RETO
      <span aria-hidden="true" className="size-1.5 translate-y-1 rounded-full bg-brand" />
    </span>
  );
}
