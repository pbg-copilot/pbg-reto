import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../../shared/api/api-client";
import type { Agent } from "../../../shared/types/domain";
import { AuthenticationError, getCurrentAgent, signIn, signOut } from "../services/auth-service";

type Credentials = { username: string; password: string };

export function useSession(resetWorkspace: () => void) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const agentRef = useRef<Agent | null>(null);
  const resetWorkspaceRef = useRef(resetWorkspace);
  resetWorkspaceRef.current = resetWorkspace;

  const restore = useCallback(async () => {
    try {
      const restored = await getCurrentAgent();
      if (restored) {
        if (agentRef.current && agentRef.current.id !== restored.id)
          resetWorkspaceRef.current();
        agentRef.current = restored;
        setAgent(restored);
        setError("");
      } else {
        agentRef.current = null;
        setAgent(null);
        resetWorkspaceRef.current();
      }
    } catch {
      setError("No pudimos conectar. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void restore(); }, [restore]);
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
  }, [agent?.id, restore]);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    return apiRequest<T>(path, init, () => {
      agentRef.current = null;
      setAgent(null);
      resetWorkspaceRef.current();
      setError("Tu sesión venció. Inicia sesión para continuar.");
    });
  }, []);

  async function login({ username, password }: Credentials): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const authenticated = await signIn(username, password);
      agentRef.current = authenticated;
      setAgent(authenticated);
      resetWorkspaceRef.current();
      return true;
    } catch (cause) {
      setError(cause instanceof AuthenticationError ? cause.message : "No pudimos conectar. Intenta de nuevo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function logout(): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      await signOut();
      agentRef.current = null;
      setAgent(null);
      resetWorkspaceRef.current();
      return true;
    } catch {
      setError("No fue posible cerrar sesión. Intenta de nuevo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { agent, loading, error, busy, api, login, logout };
}
