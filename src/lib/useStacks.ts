"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import type { StackRow } from "./stacks";

/**
 * How often the project toolbars re-read every mapped project's stack state.
 *
 * Slower than the 5s the Stacks tab used, because this now runs on the board — the
 * app's default view — rather than on a panel that was open for seconds at a time, and
 * each poll costs a `tmux list-panes -a` plus a stat per project. Nothing waits on it:
 * every action refreshes on completion, so the interval only has to catch a stack that
 * started, died or was pulled *outside* Mojito.
 */
const POLL_MS = 15_000;

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
    const iv = setInterval(refresh, POLL_MS);
    return () => clearInterval(iv);
  }, [refresh]);
  return { stacks, refresh, error };
}
