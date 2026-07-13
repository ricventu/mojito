"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import type { SessionMeta } from "@/server/types";

export function useSessions(token: string) {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const refresh = useCallback(async () => {
    if (!token) return;
    const res = await apiFetch(token, "/api/sessions");
    if (res.ok) setSessions(await res.json());
  }, [token]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { sessions, setSessions, refresh };
}
