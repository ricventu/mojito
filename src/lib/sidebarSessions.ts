import { isActiveSession } from "./activeSession";
import { orderSessions } from "./orderSessions";
import type { SessionMeta } from "@/server/types";

/**
 * What the terminal's session sidebar lists (RIC-313): the sessions still alive, the one
 * you are looking at, and nothing else.
 *
 * `currentId` is kept whatever its state, because the sidebar's second job is saying
 * where you are — and a ticket's work session sits at "done" for the whole of the QA
 * gate, which is exactly when you are most likely to be reading it. Without it the
 * sidebar would highlight nothing and quietly claim the open terminal does not exist.
 *
 * Ordering is `needs-input` first, then newest-first — `orderSessions`' own rule, which
 * also keeps a ticket's several sessions together. Splitting the two halves means a
 * session that starts waiting for an answer moves to the top under you; that is the
 * point, since it is the one thing in the list worth interrupting for, and it is the
 * same signal the board's amber pill counts.
 *
 * Returns a new array; does not mutate the input.
 */
export function sidebarSessions(sessions: SessionMeta[], currentId?: string): SessionMeta[] {
  const shown = sessions.filter((s) => isActiveSession(s) || s.id === currentId);
  const waiting = shown.filter((s) => s.state === "needs-input");
  const rest = shown.filter((s) => s.state !== "needs-input");
  return [...orderSessions(waiting), ...orderSessions(rest)];
}

/**
 * One row of that sidebar, in the shape of `terminalHeadModel`: every field normalised
 * to a string so the component branches on emptiness alone, since the four session
 * kinds carry very different amounts of metadata and a sidecar written before `title`
 * existed can leave it `undefined` despite the type (see SessionMeta).
 */
export interface SidebarItem {
  /** The session id — the row's key, and what opening it navigates to. */
  id: string;
  /** What the row leads with: the ticket id, else the session's own title, else its kind. */
  label: string;
  /** The second line, or "" when there is nothing to add. */
  detail: string;
  /** The mapped project, or "" — worth a line only because the sidebar is unfiltered. */
  project: string;
}

/** What a session with no ticket and no title of its own is called. */
const KIND_LABEL: Record<SessionMeta["kind"], string> = {
  ticket: "session",
  custom: "claude",
  intake: "new ticket",
  shell: "terminal",
};

export function sidebarItem(s: SessionMeta): SidebarItem {
  const ticket = s.ticket?.trim() ?? "";
  const title = s.title?.trim() ?? "";
  const message = s.message?.trim() ?? "";
  return {
    id: s.id,
    label: ticket || title || KIND_LABEL[s.kind],
    // A ticket session leads with its id, so its title is what the second line is for;
    // every other kind has already spent its title on the first line, and the only thing
    // left to say about it is whatever it last asked for.
    detail: ticket ? title || message : message,
    project: s.projectName ?? "",
  };
}
