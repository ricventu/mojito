"use client";
import { apiFetch } from "@/lib/client";
import type { SessionMeta, SessionState } from "@/server/types";

const BADGE: Record<SessionState, string> = {
  starting: "…", running: "●", "needs-input": "⚠", done: "✓", failed: "✕",
};

export default function SessionList(
  { token, sessions, onOpen, onChanged }:
  { token: string; sessions: SessionMeta[]; onOpen: (s: SessionMeta) => void; onChanged: () => void },
) {
  const dismiss = async (s: SessionMeta) => {
    if (s.state === "running" || s.state === "needs-input") {
      if (!confirm(`Kill the running session for ${s.ticket}?`)) return;
    }
    await apiFetch(token, `/api/sessions/${s.id}`, { method: "DELETE" });
    onChanged();
  };

  return (
    <div style={{ padding: 12 }}>
      {sessions.length === 0 && <p style={{ opacity: 0.6 }}>No sessions.</p>}
      {sessions.map((s) => (
        <div key={s.id}
          style={{ padding: 14, margin: "8px 0", borderRadius: 12,
            background: s.state === "needs-input" ? "#2a1f10" : "#151517",
            border: `1px solid ${s.state === "needs-input" ? "#a70" : "#222"}` }}>
          <div onClick={() => onOpen(s)} style={{ cursor: "pointer" }}>
            <strong>{s.ticket} · {s.launchStatus}</strong> <span>{BADGE[s.state]}</span>
            <div style={{ opacity: 0.7, fontSize: 12 }}>{s.model}·{s.effort}{s.autoAdvance ? " · auto" : ""}</div>
            {s.message && <div style={{ fontSize: 13 }}>{s.message}</div>}
          </div>
          <button onClick={() => dismiss(s)} style={{ marginTop: 8, fontSize: 12 }}>Dismiss</button>
        </div>
      ))}
    </div>
  );
}
