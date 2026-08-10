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
  return `${s.kind === "custom" ? "claude" : "work"} · ${s.model}`;
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
