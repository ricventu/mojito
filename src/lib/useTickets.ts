"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./client";
import { apiError } from "./apiError";
import type { TicketSummary } from "@/server/types";

/** How often the board re-reads Linear. */
export const TICKET_POLL_MS = 45000;

export function useTickets(token: string) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Mirrors `error` for `recover` to read. It has to be a ref and not the state: the
  // callback is handed to useEvents as `onConnect`, whose effect re-runs whenever that
  // identity changes — reading the state would rebuild `recover` on every failure and
  // tear down and redial the event socket with it.
  const failed = useRef(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch(token, "/api/tickets");
      if (!res.ok) throw new Error(await apiError(res, "could not load tickets"));
      setTickets(await res.json());
      failed.current = false;
      setError(null);
    } catch (e) {
      // Keep whatever is on screen: a failed poll means the list is stale, not empty,
      // and blanking the board loses more than it reports. Reporting it is the caller's
      // job — see `error`, and the banner the board renders from it.
      failed.current = true;
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [token]);

  /**
   * Refetch, but only after a failure — the tickets' half of the resync `useSessions`
   * gets on every event-socket reconnection and every return to the tab.
   *
   * Those signals fire far more often than the poll above, and each one is a Linear
   * query, which is why the sessions' resync deliberately left the tickets out of it: a
   * flapping socket reconnects every EVENT_RETRY_MS and would turn into a burst of them.
   * The gate keeps that guarantee — a board whose last fetch succeeded still costs
   * nothing extra — while closing the hole it left. The 45s poll is the only thing that
   * ever recovered a failed fetch, and it is not reliable in an installed web app that
   * the OS has suspended: a window backgrounded across a deploy came back to a board
   * with no tickets on it and no way to say so, which is how this was found.
   */
  const recover = useCallback(() => { if (failed.current) refresh(); }, [refresh]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, TICKET_POLL_MS);
    return () => clearInterval(iv);
  }, [refresh]);
  return { tickets, refresh, recover, error };
}
