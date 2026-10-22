import { useEffect, useRef, useState } from "react";
import type { ApiRequest } from "../../../shared/api/api-client";
import type { Client, FollowUp } from "../../../shared/types/domain";
import { completeFollowUp as completeFollowUpRequest, createFollowUp as createFollowUpRequest, listFollowUps } from "../services/follow-up-api";
import { dateInTimeZone, tomorrowInTimeZone } from "../domain/follow-up-domain";

type Options = { api: ApiRequest; conversationId: string; client: Client | null; role: string | undefined };

export function useFollowUps({ api, conversationId, client, role }: Options) {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadedContextKey, setLoadedContextKey] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const request = useRef(0);
  const clientPath = client?.document_path ?? "";
  const clientRecordId = client?.client_record_id ?? "";
  const contextKey = `${conversationId}:${clientPath}#${clientRecordId}`;
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;

  useEffect(() => {
    const requestId = ++request.current;
    if (!conversationId || !clientPath || !clientRecordId) {
      setFollowUps([]); setLoading(false); setBusy(false); setError("");
      setLoadedContextKey("");
      return;
    }
    setBusy(false);
    setFollowUps([]); setLoadedContextKey("");
    setLoading(true); setError("");
    void listFollowUps(api, conversationId).then((items) => {
      if (requestId === request.current && contextRef.current === contextKey) {
        setFollowUps(items);
        setLoadedContextKey(contextKey);
      }
    }).catch((cause) => {
      if (requestId === request.current && contextRef.current === contextKey)
        setError(cause instanceof Error ? cause.message : "No se pudieron cargar los seguimientos.");
    }).finally(() => {
      if (requestId === request.current && contextRef.current === contextKey) setLoading(false);
    });
    return () => { if (requestId === request.current) request.current += 1; };
  }, [api, conversationId, clientPath, clientRecordId, contextKey, loadRevision]);

  const ready = loadedContextKey === contextKey && !loading;

  function retryLoad() {
    if (busy || loading) return;
    setLoadedContextKey("");
    setLoadRevision((revision) => revision + 1);
  }

  async function create(description: string, dueDate: string) {
    if (!conversationId || !client || role !== "agent" || busy || !ready) return false;
    const requestId = request.current;
    setBusy(true); setError("");
    try {
      const created = await createFollowUpRequest(api, conversationId, client, description, dueDate);
      if (requestId !== request.current || contextRef.current !== contextKey) return false;
      setFollowUps((items) => [...items, created].sort((left, right) => left.due_date.localeCompare(right.due_date)));
      return true;
    } catch (cause) {
      if (requestId === request.current && contextRef.current === contextKey)
        setError(cause instanceof Error ? cause.message : "No se pudo guardar el seguimiento.");
      return false;
    } finally {
      if (requestId === request.current && contextRef.current === contextKey) setBusy(false);
    }
  }

  async function complete(id: string) {
    if (!conversationId || role !== "agent" || busy || !ready) return false;
    const requestId = request.current;
    setBusy(true); setError("");
    try {
      if (!client) return false;
      await completeFollowUpRequest(api, conversationId, id, client);
      if (requestId !== request.current || contextRef.current !== contextKey) return false;
      setFollowUps((items) => items.filter((item) => item.id !== id));
      return true;
    } catch (cause) {
      if (requestId === request.current && contextRef.current === contextKey)
        setError(cause instanceof Error ? cause.message : "No se pudo completar el seguimiento.");
      return false;
    } finally {
      if (requestId === request.current && contextRef.current === contextKey) setBusy(false);
    }
  }

  return {
    followUps: loadedContextKey === contextKey ? followUps : [], loading, busy, error, ready, canManage: role === "agent",
    create, complete, retryLoad, clearError: () => setError(""),
    defaultDueDate: tomorrowInTimeZone(new Date(), "America/Bogota"),
    minimumDueDate: dateInTimeZone(new Date(), "America/Bogota"),
  };
}
