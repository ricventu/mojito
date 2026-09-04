import { orderSessions } from "./orderSessions";
import type { SessionMeta } from "@/server/types";

/**
 * What the terminal's session sidebar lists (RIC-313): every session Mojito has a
 * registration for, ordered `needs-input` first and then newest-first.
 *
 * **Every** one of them, and not the ones in an "active" state — the mistake this was
 * first written with. A ticket session goes to `done` on every Stop once its result file
 * says ready-for-qa (see hookHandler), and sits there for the whole of the QA gate with
 * its tmux still up: Mojito never ends a session, and that one is the rework channel the
 * gate depends on. Filtering on the state therefore hid exactly the session a switcher
 * exists to switch to, and made the row flicker in and out of the list at every turn —
 * which is how it was reported, as two windows disagreeing about the count. A
 * registration lasts as long as the session does, and Kill, Dismiss and Clean up are
 * what remove it, so having one is the honest criterion. `unifiedRows` settled the same
 * question the same way for the board's Sessions filter, and says so at length.
 *
 * Splitting `needs-input` off the front means a session that starts waiting for an
 * answer moves to the top under you; that is the point, since it is the one thing in the
 * list worth interrupting for, and it is the same signal the board's amber pill counts.
 * Everything else keeps `orderSessions`' own order, which also clusters a ticket's
 * several sessions together.
 *
 * Returns a new array; does not mutate the input.
 */
export function sidebarSessions(sessions: SessionMeta[]): SessionMeta[] {
  const waiting = sessions.filter((s) => s.state === "needs-input");
  const rest = sessions.filter((s) => s.state !== "needs-input");
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
