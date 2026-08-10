"use client";
import StateBadge from "./StateBadge";
import { isActiveSession } from "@/lib/activeSession";
import type { SessionMeta } from "@/server/types";

/**
 * A session with no visible ticket to nest under — a bare claude session, a plain
 * terminal, or one whose ticket the current filters hide. Keeps its own Docs button:
 * unlike a ticket session, its cwd is not necessarily a ticket worktree.
 */
export default function SessionCard(
  { session: s, onOpen, onOpenDocs, onDismiss }:
  { session: SessionMeta; onOpen: () => void; onOpenDocs: () => void; onDismiss: () => void },
) {
  const active = isActiveSession(s);
  return (
    <div className={`card${s.state === "needs-input" ? " attn" : ""}`}>
      <div className="tap" onClick={onOpen}>
        {s.kind === "custom" || s.kind === "shell" ? (
          <>
            <div className="row">
              <span className="session-title">{s.title}</span>
              <span className="grow" />
              <StateBadge state={s.state} />
            </div>
            {s.message && <div className="title">{s.message}</div>}
          </>
        ) : (
          <>
            <div className="row">
              <span className="id">{s.ticket}</span>
              <span className="grow" />
              <StateBadge state={s.state} />
            </div>
            {s.title && <div className="session-title">{s.title}</div>}
            {s.message && <div className="title">{s.message}</div>}
          </>
        )}
        <div className="meta">
          {s.kind !== "shell" && <span className="chip">{s.model} · {s.effort}</span>}
          {s.kind === "shell" && <span className="chip">terminal</span>}
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn ghost sm grow" onClick={onOpen}>Open</button>
        <button className="btn ghost sm" onClick={onOpenDocs}>Docs</button>
        <button className={`btn sm${active ? " danger" : ""}`} onClick={onDismiss}>
          {active ? "Kill" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
