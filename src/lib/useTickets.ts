"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import type { TicketSummary } from "@/server/types";

export function useTickets(token: string) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch(token, "/api/tickets");
      if (!res.ok) throw new Error(String(res.status));
      setTickets(await res.json());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [token]);
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 45000);
    return () => clearInterval(iv);
  }, [refresh]);
  return { tickets, refresh, error };
}
