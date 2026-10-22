import { useCallback, useEffect, useState } from "react";
import "../shared/styles/styles.css";
import { LoginPage } from "../features/auth/components/LoginPage";
import { useSession } from "../features/auth/hooks/useSession";
import { AuthenticatedWorkspace } from "./AuthenticatedWorkspace";

function App() {
  const [workspaceVersion, setWorkspaceVersion] = useState(0);
  const resetWorkspace = useCallback(() => setWorkspaceVersion((version) => version + 1), []);
  const session = useSession(resetWorkspace);
  useEffect(() => {
    document.title = session.agent ? "RETO · Chat" : "RETO · Iniciar sesión";
  }, [session.agent?.id]);

  if (session.loading) return <div className="loading" role="status">
    <span className="wordmark">RETO</span><div className="loader" />Preparando tu espacio
  </div>;
  if (!session.agent) return <LoginPage busy={session.busy} error={session.error}
    onSubmit={async (credentials) => { await session.login(credentials); }} />;
  return <AuthenticatedWorkspace key={`${session.agent.id}:${workspaceVersion}`}
    agent={session.agent} api={session.api} busy={session.busy} onLogout={session.logout} />;
}

export default App;
