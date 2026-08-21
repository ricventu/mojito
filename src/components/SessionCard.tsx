"use client";
import StateBadge from "./StateBadge";
import TicketLink from "./TicketLink";
import { isActiveSession } from "@/lib/activeSession";
import { tapProps } from "@/lib/tapProps";
import type { SessionMeta } from "@/server/types";

/**
 * A session with no visible ticket to nest under — a bare claude session, a plain
 * terminal, or one whose ticket the current filters hide. Keeps its own Docs button:
 * unlike a ticket session, its cwd is not necessarily a ticket worktree.
 *
 * `ticketUrl` is the issue on Linear for the id this card shows, looked up by the
 * caller off the polled ticket list (see ticketUrls) — a session carries only the
 * identifier. Undefined whenever that list cannot answer, which for this card is
 * common: the loose group is where a session whose ticket is gone ends up.
 */
export default function SessionCard(
  { session: s, ticketUrl, onOpen, onOpenDocs, onDismiss }:
  { session: SessionMeta; ticketUrl?: string; onOpen: () => void; onOpenDocs: () => void;
    onDismiss: () => void },
) {
  const active = isActiveSession(s);
  return (
    <div className={`card${s.state === "needs-input" ? " attn" : ""}`}>
      {/* A ticket session leads with its id, which links to Linear — so that row sits
          outside the tap region below, where a link would be swallowed by the
          `role="button"` (see TicketLink). A custom or shell session has no id, so
          its own header row stays inside the tap. */}
      {s.kind !== "custom" && s.kind !== "shell" && (
        <div className="card-head">
          <TicketLink id={s.ticket ?? ""} url={ticketUrl} />
          <span className="grow" />
          <StateBadge state={s.state} />
        </div>
      )}
      <div className="tap" {...tapProps(onOpen)}>
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
