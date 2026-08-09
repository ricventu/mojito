"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { useStacks } from "@/lib/useStacks";
import { useSelfUpdate } from "@/lib/useSelfUpdate";
import { pullMessage, pushMessage, syntheticStackSession, type PullResponse, type PushResponse, type StackRow } from "@/lib/stacks";
import type { SessionMeta } from "@/server/types";

type SelfUpdate = ReturnType<typeof useSelfUpdate>;

export default function StacksPanel({ token, onOpenLogs }: { token: string; onOpenLogs: (s: SessionMeta) => void }) {
  const { stacks, refresh } = useStacks(token);
  const selfUpdate = useSelfUpdate(token);
  return (
    <div className="pad">
      <section>
        <h4 className="sect">Stacks</h4>
        {stacks.map((row) => (
          <StackRowView key={row.slug} row={row} token={token} onOpenLogs={onOpenLogs} refresh={refresh} selfUpdate={selfUpdate} />
        ))}
      </section>
    </div>
  );
}

function StackRowView({ row, token, onOpenLogs, refresh, selfUpdate }: {
  row: StackRow; token: string; onOpenLogs: (s: SessionMeta) => void; refresh: () => void; selfUpdate: SelfUpdate;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string; canResolve: boolean } | null>(null);

  const act = async (path: string) => {
    setBusy(true);
    try { await apiFetch(token, `/api/stacks/${row.slug}/${path}`, { method: "POST" }); await refresh(); }
    finally { setBusy(false); }
  };
  const pull = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(token, `/api/stacks/${row.slug}/pull`, { method: "POST" });
      setMsg(pullMessage((await res.json()) as PullResponse));
      await refresh();
    } finally { setBusy(false); }
  };
  const push = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(token, `/api/stacks/${row.slug}/push`, { method: "POST" });
      setMsg({ ...pushMessage((await res.json()) as PushResponse), canResolve: false });
      await refresh();
    } finally { setBusy(false); }
  };
  const resolve = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(token, `/api/stacks/${row.slug}/resolve`, { method: "POST" });
      if (res.ok) onOpenLogs((await res.json()).meta as SessionMeta);
    } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="s-row">
        <span className={`s-dot ${row.status ?? ""}`} />
        <strong>{row.project}</strong>
        {row.hasStack && <span className="substatus">{row.status}</span>}
      </div>
      <div className="s-actions">
        {row.hasStack && row.status !== "running" && (
          <button className="btn sm" disabled={busy} onClick={() => act("start")}>Start</button>
        )}
        {/* Stop is always available: detection may read "crashed"/"stopped" while
            orphan processes still hold the ports, so the user must always be able
            to force a clean stop. */}
        {row.hasStack && (
          <button className="btn sm" disabled={busy} onClick={() => act("stop")}>Stop</button>
        )}
        {row.hasStack && (
          <button className="btn sm ghost" onClick={() => onOpenLogs(syntheticStackSession(row.slug, row.project))}>Logs</button>
        )}
        {row.pullable && (
          <button className="btn sm ghost" disabled={busy} onClick={pull}>Pull</button>
        )}
        <button className="btn sm ghost" disabled={busy} onClick={push}>Push</button>
        {/* Mojito's own checkout has a post-merge hook that starts the deploy unit, so its
            Pull is the guarded /api/self-update flow (banner + health-poll + reload), not
            the raw stacks pull. Hidden entirely when MOJITO_SELF_UPDATE is off. */}
        {row.self && selfUpdate.enabled && (
          <button
            className="btn sm ghost"
            disabled={busy || selfUpdate.phase === "pulling" || selfUpdate.phase === "deploying"}
            onClick={selfUpdate.run}
          >
            {selfUpdate.phase === "pulling" ? "Pulling…" : selfUpdate.phase === "deploying" ? "Deploying…" : "Pull & deploy"}
          </button>
        )}
      </div>
      {msg && <p className={msg.kind === "err" ? "err-text" : "sheet-title"}>{msg.text}</p>}
      {row.self && selfUpdate.message && <p className="sheet-title">{selfUpdate.message}</p>}
      {row.self && selfUpdate.phase === "deploying" && (
        <p className="sheet-title">Deploying — the server restarts in ~1 min…</p>
      )}
      {row.self && selfUpdate.phase === "timeout" && <p className="err-text">Deploy still running — reload manually.</p>}
      {row.self && selfUpdate.error && <p className="err-text">{selfUpdate.error}</p>}
      {msg?.canResolve && (
        <button className="btn sm primary" disabled={busy} onClick={resolve}>Resolve with Claude</button>
      )}
    </div>
  );
}
