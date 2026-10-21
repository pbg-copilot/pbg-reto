import { useEffect, useState, type FormEvent } from "react";
import { ArrowRightIcon, ShieldCheckIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Wordmark } from "@/components/brand/Wordmark";
import { useLogin } from "./useSession";

export function LoginPage() {
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    document.title = "RETO · Iniciar sesión";
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    login.mutate(
      { usuario: username, contrasena: password },
      { onSuccess: () => setPassword("") },
    );
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Panel de marca: siempre usa los tokens del tema oscuro (sitio PBG). */}
      <aside className="dark relative hidden flex-col justify-between overflow-hidden bg-background p-12 text-foreground lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 -left-32 size-[520px] rounded-full bg-primary/25 blur-3xl"
        />
        <Wordmark className="relative text-2xl" />
        <div className="relative flex max-w-md flex-col gap-6">
          <span className="eyebrow">El siguiente paso empieza aquí</span>
          <h1 className="text-5xl leading-[1.05] font-bold tracking-tight">
            Las buenas ideas merecen un <span className="text-brand">gran comienzo.</span>
          </h1>
          <p className="text-muted-foreground">Un espacio para conectar información, resolver y construir.</p>
        </div>
        <span className="relative flex items-center gap-2 eyebrow text-gold">
          <ShieldCheckIcon aria-hidden="true" className="size-4" />
          Entorno de prueba
        </span>
      </aside>

      <main className="flex flex-col items-center justify-center gap-8 px-4 py-10 sm:px-8">
        <Wordmark className="lg:hidden" />
        <Card className="glass w-full max-w-md">
          <CardHeader>
            <span className="eyebrow text-primary">Bienvenido a tu espacio</span>
            <CardTitle>
              <h2 className="text-2xl font-bold tracking-tight">Inicia sesión</h2>
            </CardTitle>
            <CardDescription>Ingresa tus datos para continuar.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate={false}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="username">Usuario</FieldLabel>
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    required
                    maxLength={254}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Tu usuario o correo"
                    autoCapitalize="none"
                    spellCheck={false}
                    className="h-10"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">Contraseña</FieldLabel>
                  <InputGroup className="h-10">
                    <InputGroupInput
                      id="password"
                      name="password"
                      autoComplete="current-password"
                      required
                      maxLength={256}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      type={showPassword ? "text" : "password"}
                      placeholder="Tu contraseña"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        type="button"
                        aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                        onClick={() => setShowPassword((value) => !value)}
                      >
                        {showPassword ? "Ocultar" : "Mostrar"}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
                {login.error && (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>{login.error.message}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" size="lg" className="h-11 w-full" disabled={login.isPending}>
                  {login.isPending ? (
                    <>
                      <Spinner aria-label="Ingresando" data-icon="inline-start" />
                      Ingresando…
                    </>
                  ) : (
                    <>
                      Ingresar
                      <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
                    </>
                  )}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        <p className="max-w-md text-center text-xs text-muted-foreground">
          Entorno local de prueba con contactos e IDs sustituidos.
        </p>
      </main>
    </div>
  );
}
