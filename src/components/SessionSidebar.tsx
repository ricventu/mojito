"use client";
import { Pin, PinOff, X } from "lucide-react";
import StateBadge from "./StateBadge";
import { sidebarItem, sidebarSessions } from "@/lib/sidebarSessions";
import type { SidebarView } from "@/lib/sidebarState";
import type { SessionMeta } from "@/server/types";

/**
 * The terminal's list of live sessions (RIC-313), so that switching between the several
 * running at once does not mean backing out to the board and finding the card again.
 *
 * It exists here and not on the board because the board *is* a list of sessions: every
 * one of them is already a card there, and a second copy of the same names beside it
 * would be furniture. The terminal is the one view where the other sessions are
 * unreachable without leaving.
 *
 * Deliberately unfiltered — it has no relationship with the board's filters (which are
 * the board's, and which a terminal url is built clean of), and the session you need to
 * get back to is exactly the one a status chip might be hiding.
 */
export default function SessionSidebar(
  { sessions, currentId, view, onOpen, onTogglePin, onClose }:
  {
    sessions: SessionMeta[];
    currentId: string;
    view: SidebarView;
    onOpen: (id: string) => void;
    onTogglePin: () => void;
    onClose: () => void;
  },
) {
  const items = sidebarSessions(sessions, currentId);
  return (
    <aside className="term-side" aria-label="Active sessions">
      <div className="term-side-head">
        <span className="term-side-title">Sessions</span>
        <span className="grow" />
        {view.canPin && (
          <button
            className="btn sm icon"
            aria-pressed={view.docked}
            aria-label={view.docked ? "Unpin sidebar" : "Pin sidebar open"}
            title={view.docked ? "Unpin sidebar" : "Pin sidebar open"}
            onClick={onTogglePin}
          >
            {view.docked
              ? <PinOff size={15} aria-hidden="true" />
              : <Pin size={15} aria-hidden="true" />}
          </button>
        )}
        <button className="btn sm icon" aria-label="Close sidebar" title="Close sidebar" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="term-side-list">
        {items.length === 0 && <p className="term-side-empty">No live sessions.</p>}
        {items.map((s) => {
          const item = sidebarItem(s);
          const current = s.id === currentId;
          return (
            <button
              key={item.id}
              type="button"
              className={`side-item${current ? " current" : ""}${s.state === "needs-input" ? " attn" : ""}`}
              // aria-current, not aria-pressed: tapping the open session re-opens it
              // rather than toggling anything off.
              aria-current={current ? "true" : undefined}
              onClick={() => onOpen(item.id)}
            >
              <span className="side-item-head">
                <span className="side-item-label">{item.label}</span>
                <span className="grow" />
                <StateBadge state={s.state} />
              </span>
              {item.detail && <span className="side-item-detail">{item.detail}</span>}
              {item.project && <span className="side-item-proj">{item.project}</span>}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
