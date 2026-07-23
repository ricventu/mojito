"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import type { StackRow } from "./stacks";

export function useStacks(token: string) {
  const [stacks, setStacks] = useState<StackRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch(token, "/api/stacks");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setStacks(data.stacks);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [token]);
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5000);
    return () => clearInterval(iv);
  }, [refresh]);
  return { stacks, refresh, error };
}
