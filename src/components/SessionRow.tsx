"use client";
import StateBadge from "./StateBadge";
import { isActiveSession } from "@/lib/activeSession";
import { tapProps } from "@/lib/tapProps";
import type { SessionMeta } from "@/server/types";

/**
 * A session shown inside its ticket's card. The ticket identifier is on the card
 * already, so the row leads with what the card cannot say: which kind of session this
 * is and which model is driving it.
 */
function rowLabel(s: SessionMeta): string {
  if (s.kind === "shell") return "terminal";
  // "new ticket" is unreachable in practice — an intake session has no ticket to nest
  // under, so it only ever renders as a loose SessionCard — but naming it here keeps the
  // fallback from calling it "work", which is the one thing it certainly is not.
  const what = s.kind === "custom" ? "claude" : s.kind === "intake" ? "new ticket" : "work";
  return `${what} · ${s.model}`;
}

export default function SessionRow(
  { session, onOpen, onDismiss }:
  { session: SessionMeta; onOpen: () => void; onDismiss: () => void },
) {
  const active = isActiveSession(session);
  return (
    <div className="srow">
      <div className="srow-tap" {...tapProps(onOpen)}>
        <div className="row">
          <span className="srow-label">{rowLabel(session)}</span>
          <span className="grow" />
          <StateBadge state={session.state} />
        </div>
        {session.message && <div className="srow-msg">{session.message}</div>}
      </div>
      <button
        className={`btn sm${active ? " danger" : ""}`}
        onClick={onDismiss}
      >
        {active ? "Kill" : "Dismiss"}
      </button>
    </div>
  );
}
