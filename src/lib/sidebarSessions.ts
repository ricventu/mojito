import { orderSessions } from "./orderSessions";
import type { SessionMeta } from "@/server/types";

/**
 * What the session sidebar lists (RIC-313): every session Mojito has a registration
 * for, **grouped by project** and otherwise in `orderSessions`' own order.
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
 * **Nothing here depends on a session's state**, which is the point of the grouping.
 * It shipped with `needs-input` split off the front, on the grounds that a session
 * waiting for an answer is the one thing in the list worth interrupting for — but that
 * is a *live* key, so a row jumped to the top and back down again as its session asked
 * and was answered, and the card you were reaching for moved under your finger. A
 * switcher whose rows will not hold still is the one thing it must not be, and the
 * signal is not lost: the row keeps its `.attn` styling and its StateBadge either way,
 * and the board's amber pill is what counts them. Every key the order rests on now is
 * immutable for the life of a session — its project, its ticket, its `createdAt`, its
 * id — so the list only ever changes when a session is launched or removed.
 *
 * Grouping by project is what was asked for: the sidebar is deliberately unfiltered, so
 * on a machine working two or three repos at once it interleaved them, and the sessions
 * of the repo you are actually in were scattered down a list ordered by clock time.
 * Groups themselves are ordered by their newest session (and named-ties by project, with
 * the project-less sessions of a General launch simply forming the `""` group and taking
 * their turn by the same rule), so a freshly launched session still brings its project
 * to the top — at launch, which is the one moment the list is allowed to rearrange.
 *
 * Returns a new array; does not mutate the input.
 */
export function sidebarSessions(sessions: SessionMeta[]): SessionMeta[] {
  const groups = new Map<string, SessionMeta[]>();
  for (const s of sessions) {
    const key = s.projectName ?? "";
    const arr = groups.get(key);
    if (arr) arr.push(s);
    else groups.set(key, [s]);
  }

  const ordered = [...groups.entries()].map(([project, arr]) => {
    const sorted = orderSessions(arr);
    return { project, sorted, newest: sorted[0].createdAt }; // sorted[0] is the newest
  });

  // Newest group first; two groups whose newest sessions share a timestamp fall back to
  // the project name, so the order is total and never depends on insertion order.
  ordered.sort(
    (a, b) =>
      (a.newest < b.newest ? 1 : a.newest > b.newest ? -1 : 0) ||
      (a.project < b.project ? -1 : a.project > b.project ? 1 : 0),
  );

  return ordered.flatMap((g) => g.sorted);
}

/**
 * Part the sidebar's sessions into the ones it lists and the ones the human tucked away
 * under "Hidden" — each half in the order it was handed, so feed it `sidebarSessions`'
 * output and both keep the project grouping. Hiding exists for sidebar clutter (a
 * long-lived shell nobody switches to), and it moves only the row that was hidden: the
 * rest hold still, which is the one thing this list promises.
 *
 * `overrides` is the component's optimistic answer while a PATCH is in flight, keyed by
 * session id, and wins over the server's flag.
 */
export function splitHidden(
  sessions: SessionMeta[],
  overrides: Record<string, boolean> = {},
): { visible: SessionMeta[]; hidden: SessionMeta[] } {
  const visible: SessionMeta[] = [];
  const hidden: SessionMeta[] = [];
  for (const s of sessions) {
    const isHidden = s.id in overrides ? overrides[s.id] : s.hidden === true;
    (isHidden ? hidden : visible).push(s);
  }
  return { visible, hidden };
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
  improve: "improve",
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
