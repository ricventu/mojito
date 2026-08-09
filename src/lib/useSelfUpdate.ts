"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./client";
import { initialPollState, nextPollState } from "./deployPoll";
import { selfUpdateMessage, type SelfUpdateResponse } from "./selfUpdate";

export type SelfUpdatePhase = "idle" | "pulling" | "deploying" | "timeout";

/**
 * The return type of `useSelfUpdate`. Callers (`StacksPanel`, `SettingsSheet`) take
 * this as a prop rather than re-declaring it, since the hook is called once — in
 * `page.tsx` — and shared between them.
 */
export type SelfUpdate = ReturnType<typeof useSelfUpdate>;

/**
 * The server's "Pull & deploy" control, shared by the Settings sheet and the Stacks
 * self-row. `enabled` mirrors MOJITO_SELF_UPDATE: when false the server has no
 * /api/self-update endpoint and no caller should render the control.
 *
 * Called once, at the top level of `page.tsx`, and passed down to both callers —
 * calling it twice would mean two independent capability probes and two independent
 * phase machines that could disagree about whether a deploy is in flight.
 */
export function useSelfUpdate(token: string) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<SelfUpdatePhase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch(token, "/api/self-update")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (b && typeof b.enabled === "boolean") setEnabled(b.enabled); })
      .catch(() => { /* leave the control hidden */ });
  }, [token]);

  // Poll /api/health while a deploy is in flight, tied to the caller's lifecycle: if the
  // component unmounts mid-deploy or phase moves away from "deploying", the cleanup
  // cancels the pending tick so no further poll, setPhase, or reload runs after that
  // point — the user then reloads manually (see phase === "timeout").
  useEffect(() => {
    if (phase !== "deploying") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let state = initialPollState;
    const startedAt = Date.now();
    const tick = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > 5 * 60_000) { setPhase("timeout"); return; }
      let up = false;
      try { up = (await apiFetch(token, "/api/health")).ok; } catch { up = false; }
      if (cancelled) return;
      state = nextPollState(state, up);
      if (state.recovered) { location.reload(); return; }
      timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [phase, token]);

  const run = useCallback(async () => {
    setError(null);
    setMessage(null);
    setPhase("pulling");
    let res: Response;
    try {
      res = await apiFetch(token, "/api/self-update", { method: "POST" });
    } catch {
      setPhase("idle");
      setError("Network error — could not reach the server.");
      return;
    }
    const body = (await res.json().catch(() => ({}))) as SelfUpdateResponse;
    const msg = selfUpdateMessage(body);
    if (res.status === 200 && "status" in body) {
      setMessage(msg.text);
      setPhase("deploying");
      return;
    }
    setPhase("idle");
    setError(msg.text);
  }, [token]);

  return { enabled, phase, message, error, run };
}
