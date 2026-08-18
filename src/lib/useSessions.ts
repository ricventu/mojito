"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import type { SessionMeta } from "@/server/types";

export function useSessions(token: string) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  // Distinguishes "not fetched yet" from "fetched, and this session is gone", which
  // is what a /session/<id> url needs before it can decide to fall back to the list
  // instead of flashing past a terminal that was about to load. Set once the request
  // has answered, ok or not: either way the empty list is the best answer there is.
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    if (!token) return;
    const res = await apiFetch(token, "/api/sessions");
    if (res.ok) setSessions(await res.json());
    setLoaded(true);
  }, [token]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { sessions, setSessions, refresh, loaded };
}
