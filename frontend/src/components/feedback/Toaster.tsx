import { Toast as ToastPrimitive } from "radix-ui";
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast, useToasts, type ToastVariant } from "./toast-store";

// Toast de Radix y no sonner: sonner inyecta un <style> sin nonce y la CSP lo bloquea.
// Radix anuncia cada aviso a los lectores de pantalla, permite descartarlo deslizando y
// F8 lleva el foco a la región de avisos.
const ICONS = { success: CircleCheckIcon, error: CircleAlertIcon, info: InfoIcon } satisfies Record<ToastVariant, unknown>;
const ICON_COLOR: Record<ToastVariant, string> = {
  success: "text-success",
  error: "text-destructive",
  info: "text-brand",
};

export function Toaster() {
  const items = useToasts();
  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={4500} label="Aviso">
      {items.map((item) => {
        const Icon = ICONS[item.variant];
        return (
          <ToastPrimitive.Root
            key={item.id}
            // Los errores interrumpen al lector de pantalla; los demás esperan su turno.
            type={item.variant === "error" ? "foreground" : "background"}
            duration={item.variant === "error" ? 7000 : undefined}
            onOpenChange={(open) => !open && toast.dismiss(item.id)}
            data-testid="toast"
            className={cn(
              "glass group pointer-events-auto relative flex w-full items-start gap-3 rounded-xl border p-4 pr-10 shadow-lg",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 sm:data-[state=open]:slide-in-from-right-4",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
              "data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform data-[swipe=end]:animate-out data-[swipe=end]:fade-out-0",
              item.variant === "error" && "border-destructive/40",
            )}
          >
            <Icon aria-hidden="true" className={cn("mt-0.5 size-5 shrink-0", ICON_COLOR[item.variant])} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <ToastPrimitive.Title className="text-sm font-semibold">{item.title}</ToastPrimitive.Title>
              {item.description && (
                <ToastPrimitive.Description className="text-sm text-muted-foreground">{item.description}</ToastPrimitive.Description>
              )}
              {item.action && (
                <ToastPrimitive.Action altText={item.action.label} asChild>
                  <Button size="sm" variant="outline" className="mt-1 self-start" onClick={item.action.onClick}>
                    {item.action.label}
                  </Button>
                </ToastPrimitive.Action>
              )}
            </div>
            <ToastPrimitive.Close
              aria-label="Cerrar aviso"
              className="absolute top-3 right-3 rounded-full p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <XIcon aria-hidden="true" className="size-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport
        label="Avisos ({hotkey})"
        className="fixed right-0 bottom-0 z-[100] m-0 flex w-full list-none flex-col gap-2 p-4 outline-none sm:max-w-sm"
      />
    </ToastPrimitive.Provider>
  );
}
