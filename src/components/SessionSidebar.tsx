"use client";
import { Pin, PinOff, X } from "lucide-react";
import StateBadge from "./StateBadge";
import { sidebarItem, sidebarSessions } from "@/lib/sidebarSessions";
import type { SidebarView } from "@/lib/sidebarState";
import type { SessionMeta } from "@/server/types";

/**
 * The list of live sessions (RIC-313), so that switching between the several running at
 * once does not mean hunting for the right card.
 *
 * It began as the terminal's alone, on the grounds that the board *is* a list of
 * sessions and a second copy of the same names would be furniture. That holds for a
 * board with nothing hidden, and not otherwise: the Backlog is out by default (RIC-275),
 * a project or status filter narrows further, and the session worth getting back to is
 * exactly the one a chip might be hiding — while the sidebar is deliberately unfiltered.
 * So the same list serves both views, and a pinned one simply stays where it is as you
 * move between them (see useSidebar for the one shared pin).
 *
 * Unfiltered, then, on both hosts: it has no relationship with the board's filters
 * (which a terminal url is built clean of anyway). Nor is it filtered on the session
 * state — see sidebarSessions for why a "done" session belongs here most of all.
 *
 * `place` is only ever how the element is positioned; every rule about *what* it shows
 * is the same on both. See `.sess-side.board` in globals.css.
 */
export default function SessionSidebar(
  { sessions, currentId, view, place, onOpen, onTogglePin, onClose }:
  {
    sessions: SessionMeta[];
    /** The session this view is already on, or "" on the board, where there is none. */
    currentId: string;
    view: SidebarView;
    place: "terminal" | "board";
    onOpen: (id: string) => void;
    onTogglePin: () => void;
    onClose: () => void;
  },
) {
  const items = sidebarSessions(sessions);
  return (
    <aside
      // The terminal takes its arrangement from `.term-root`'s own `docked` class, since
      // there the two states are two shapes of one flex row. The board has no such row,
      // so it carries both flags itself.
      className={`sess-side${place === "board" ? " board" : ""}${place === "board" && view.docked ? " docked" : ""}`}
      aria-label="Active sessions"
    >
      <div className="sess-side-head">
        <span className="sess-side-title">Sessions</span>
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
      <div className="sess-side-list">
        {items.length === 0 && <p className="sess-side-empty">No live sessions.</p>}
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
