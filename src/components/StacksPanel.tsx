"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/client";
import { useStacks } from "@/lib/useStacks";
import { pullMessage, syntheticStackSession, type PullResponse, type StackRow } from "@/lib/stacks";
import type { SessionMeta } from "@/server/types";

export default function StacksPanel({ token, onOpenLogs }: { token: string; onOpenLogs: (s: SessionMeta) => void }) {
  const { stacks, refresh } = useStacks(token);
  return (
    <div className="pad">
      <section>
        <h4 className="sect">Stacks</h4>
        {stacks.map((row) => (
          <StackRowView key={row.slug} row={row} token={token} onOpenLogs={onOpenLogs} refresh={refresh} />
        ))}
      </section>
    </div>
  );
}

function StackRowView({ row, token, onOpenLogs, refresh }: {
  row: StackRow; token: string; onOpenLogs: (s: SessionMeta) => void; refresh: () => void;
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
        {row.hasStack && row.status === "running" && (
          <button className="btn sm" disabled={busy} onClick={() => act("stop")}>Stop</button>
        )}
        {row.hasStack && (
          <button className="btn sm ghost" onClick={() => onOpenLogs(syntheticStackSession(row.slug, row.project))}>Logs</button>
        )}
        {row.pullable && (
          <button className="btn sm ghost" disabled={busy} onClick={pull}>Pull</button>
        )}
      </div>
      {msg && <p className={msg.kind === "err" ? "err-text" : "sheet-title"}>{msg.text}</p>}
      {msg?.canResolve && (
        <button className="btn sm primary" disabled={busy} onClick={resolve}>Resolve with Claude</button>
      )}
    </div>
  );
}
