import { useState } from "react";
import { Arrow } from "../../../shared/ui/ui";

type LoginPageProps = {
  busy: boolean;
  error: string;
  onSubmit: (credentials: { username: string; password: string }) => Promise<void>;
};

export function LoginPage({ busy, error, onSubmit }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="login-layout">
      <aside className="intro">
        <div className="wordmark">RETO<span className="brand-dot" /></div>
        <div className="intro-body">
          <span className="eyebrow">EL SIGUIENTE PASO EMPIEZA AQUÍ</span>
          <h1>Las buenas ideas<br />merecen un<br /><span>gran comienzo.</span></h1>
          <p>Un espacio para conectar información,<br />resolver y construir.</p>
          <div className="intro-line" />
        </div>
        <div className="intro-footer"><span className="status-square" />ENTORNO DE PRUEBA</div>
      </aside>
      <main className="login-main">
        <div className="mobile-brand wordmark">RETO</div>
        <form className="login-form" onSubmit={(event) => { event.preventDefault(); void onSubmit({ username, password }); }}>
          <span className="eyebrow teal">BIENVENIDO A TU ESPACIO</span>
          <h2>Inicia sesión</h2>
          <p className="form-intro">Ingresa tus datos para continuar.</p>
          <label htmlFor="username">Usuario</label>
          <input id="username" name="username" autoComplete="username" required maxLength={254} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Tu usuario o correo" autoCapitalize="none" spellCheck={false} />
          <label htmlFor="password">Contraseña</label>
          <div className="password-field">
            <input id="password" name="password" autoComplete="current-password" required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} placeholder="Tu contraseña" />
            <button type="button" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Ocultar" : "Mostrar"}</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="login-button" type="submit" disabled={busy}>{busy ? "Ingresando…" : "Ingresar"}{!busy && <Arrow />}</button>
          <p className="demo-hint"><span className="small-square" />Entorno local de prueba con contactos e IDs sustituidos.</p>
        </form>
        <footer className="login-footer">RETO <span>Un nuevo punto de partida.</span></footer>
      </main>
    </div>
  );
}
