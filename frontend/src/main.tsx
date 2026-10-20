import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
type Agent = {
  id: string;
  name: string;
  username: string;
  email: string;
  agency_name: string | null;
  role: string;
};
function Arrow() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M5 12h14m-5-5 5 5-5 5" />
    </svg>
  );
}
function Chevron() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M9 5H5v14h4m5-14 7 7-7 7m7-7H9" />
    </svg>
  );
}
function App() {
  const [agent, setAgent] = useState<Agent | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const menuRef = useRef<HTMLDivElement>(null),
    buttonRef = useRef<HTMLButtonElement>(null);
  async function restore() {
    try {
      const r = await fetch("/auth/me", { credentials: "same-origin" });
      if (r.ok) {
        setAgent((await r.json()).agent);
        setError("");
      } else if (r.status === 401) {
        setAgent(null);
      } else {
        setError("No pudimos conectar. Intenta de nuevo.");
      }
    } catch {
      setError("No pudimos conectar. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void restore();
  }, []);
  useEffect(() => {
    document.title = agent ? "RETO · Inicio" : "RETO · Iniciar sesión";
  }, [agent]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenu(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);
  useEffect(() => {
    if (!agent) return;
    const check = () => {
      if (document.visibilityState === "visible") void restore();
    };
    const interval = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", check);
    };
  }, [agent?.id]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/auth/get-toke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ usuario: username, contrasena: password }),
      });
      const body = await r.json();
      if (!r.ok) {
        setError(body.message || "No fue posible iniciar sesión.");
        return;
      }
      setAgent(body.agent);
      setPassword("");
      setMenu(false);
    } catch {
      setError("No pudimos conectar. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!r.ok) throw new Error();
      setAgent(null);
      setMenu(false);
      setPassword("");
    } catch {
      setError("No fue posible cerrar sesión. Intenta de nuevo.");
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="loading" role="status">
        <span className="wordmark">RETO</span>
        <div className="loader" />
        Preparando tu espacio
      </div>
    );
  if (agent)
    return (
      <div className="workspace">
        <header className="topbar">
          <a className="wordmark" href="/" aria-label="RETO, inicio">
            RETO
            <span className="brand-dot" />
          </a>
          <div className="account" ref={menuRef}>
            <div className="agent-label">
              <span className="eyebrow">AGENTE</span>
              <span data-testid="agent-name">{agent.name}</span>
            </div>
            <button
              ref={buttonRef}
              className="account-toggle"
              aria-label="Menú de cuenta"
              aria-expanded={menu}
              aria-haspopup="menu"
              onClick={() => setMenu(!menu)}
            >
              <span className="avatar">
                {agent.name
                  .split(" ")
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join("")}
              </span>
              <Chevron />
            </button>
            {menu && (
              <div className="account-menu" role="menu">
                <button
                  role="menuitem"
                  onClick={() => void logout()}
                  disabled={busy}
                >
                  <LogoutIcon />
                  {busy ? "Cerrando sesión…" : "Logout"}
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="home">
          <div className="home-heading">
            <span className="eyebrow teal">TU ESPACIO DE TRABAJO</span>
            <h1>Hola, {agent.name.split(" ")[0]}.</h1>
            <p>Todo listo para empezar.</p>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <section className="welcome-card">
            <div className="card-top">
              <span className="status-square" />
              <span>SESIÓN INICIADA</span>
            </div>
            <h2>
              Un espacio para construir
              <br />
              lo que sigue.
            </h2>
            <p>
              Tu entorno está preparado. Este es el punto de partida del reto.
            </p>
            <div className="workspace-detail">
              <div>
                <span className="eyebrow">AGENTE</span>
                <strong>{agent.name}</strong>
              </div>
              <div>
                <span className="eyebrow">ORGANIZACIÓN</span>
                <strong>{agent.agency_name || "Independiente"}</strong>
              </div>
              <div>
                <span className="eyebrow">ENTORNO</span>
                <strong>Prueba · Datos ficticios</strong>
              </div>
            </div>
          </section>
          <div className="home-foot">
            <span>RETO</span>
            <span>Diseñado para dar el siguiente paso.</span>
          </div>
        </main>
      </div>
    );
  return (
    <div className="login-layout">
      <aside className="intro">
        <div className="wordmark">
          RETO
          <span className="brand-dot" />
        </div>
        <div className="intro-body">
          <span className="eyebrow">EL SIGUIENTE PASO EMPIEZA AQUÍ</span>
          <h1>
            Las buenas ideas
            <br />
            merecen un
            <br />
            <span>gran comienzo.</span>
          </h1>
          <p>
            Un espacio para conectar información,
            <br />
            resolver y construir.
          </p>
          <div className="intro-line" />
        </div>
        <div className="intro-footer">
          <span className="status-square" />
          ENTORNO DE PRUEBA
        </div>
      </aside>
      <main className="login-main">
        <div className="mobile-brand wordmark">RETO</div>
        <form className="login-form" onSubmit={(e) => void login(e)}>
          <span className="eyebrow teal">BIENVENIDO A TU ESPACIO</span>
          <h2>Inicia sesión</h2>
          <p className="form-intro">Ingresa tus datos para continuar.</p>
          <label htmlFor="username">Usuario</label>
          <input
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
          />
          <label htmlFor="password">Contraseña</label>
          <div className="password-field">
            <input
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
            <button
              type="button"
              aria-label={
                showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
              }
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="login-button" type="submit" disabled={busy}>
            {busy ? "Ingresando…" : "Ingresar"}
            {!busy && <Arrow />}
          </button>
          <p className="demo-hint">
            <span className="small-square" />
            Estás en un entorno con datos ficticios.
          </p>
        </form>
        <footer className="login-footer">
          RETO <span>Un nuevo punto de partida.</span>
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
