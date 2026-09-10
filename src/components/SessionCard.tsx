"use client";
import { useEffect, useState } from "react";
import StateBadge from "./StateBadge";
import TicketLink from "./TicketLink";
import RepoRootBadge from "./RepoRootBadge";
import { isActiveSession } from "@/lib/activeSession";
import { tapProps } from "@/lib/tapProps";
import { apiFetch } from "@/lib/client";
import type { SessionMeta } from "@/server/types";

interface RepoInfo {
  repoRoot: string;
  branch: string;
  isRepoRoot: boolean;
}

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
  const [repoInfo, setRepoInfo] = useState<RepoInfo | null>(null);

  useEffect(() => {
    // Fetch the repo root and branch for this session (RIC-333). The token is read
    // from the same source the rest of the app uses — a missing one means the gate
    // is still up, so skip the call rather than failing it.
    const token = (document.cookie.match(/mojito-token=([^;]+)/) ?? [])[1];
    if (!token) return;
    let live = true;
    apiFetch(token, `/api/sessions/${s.id}/repo-info`)
      .then((res) => { if (live && res.ok) return res.json(); return null; })
      .then((data) => { if (live && data) setRepoInfo(data); })
      .catch(() => { /* session gone or endpoint unreachable — hide the badge */ });
    return () => { live = false; };
  }, [s.id]);

  return (
    <div className={`card${s.state === "needs-input" ? " attn" : ""}`}>
      {/* A ticket session leads with its id, which links to Linear — so that row sits
          outside the tap region below, where a link would be swallowed by the
          `role="button"` (see TicketLink). Every other kind — custom, intake, shell —
          has no id, so its own header row stays inside the tap. Keyed on "is a ticket
          session" rather than on the kinds that are not, so a kind added later cannot
          land here asking for a ticket link it has no ticket for. */}
      {s.kind === "ticket" && (
        <div className="card-head">
          <TicketLink id={s.ticket ?? ""} url={ticketUrl} />
          <span className="grow" />
          <StateBadge state={s.state} />
        </div>
      )}
      <div className="tap" {...tapProps(onOpen)}>
        {s.kind !== "ticket" ? (
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
          {repoInfo?.repoRoot && (
            <RepoRootBadge
              repoRoot={repoInfo.repoRoot}
              branch={repoInfo.branch}
              isRepoRoot={repoInfo.isRepoRoot}
            />
          )}
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
