import type { AppView, ListFilters } from "./appLocation";
import type { SessionMeta } from "@/server/types";

/**
 * Which project the New ticket sheet opens on. (New session takes the board's project
 * filter directly — it is only reachable from the list — through the same soleProject.)
 *
 * The action sits in the terminal header as well as on the board (RIC-224), and a
 * ticket jotted down while watching a session almost always belongs to that session's
 * repo — so the open session's own project wins there, ahead of whatever project chip
 * the board was left filtered on. Everywhere else that chip is the best guess
 * available, and it survives across views because the filters ride along on every path
 * (see formatLocation).
 *
 * `picked` is the one answer that is not a guess: a project section's toolbar carries
 * the action too, and there the divider names the project outright, so it wins over
 * both rules below — including the open session's, since a board is only ever behind a
 * terminal, never in front of one. Every other call site passes nothing.
 *
 * `null` means "General (home)": no project, the sheet's own default.
 */
export function newTicketProject(
  view: AppView, filters: ListFilters, session: SessionMeta | null, picked?: string | null,
): string | null {
  if (picked?.trim()) return picked.trim();
  // `session` can be null on a session view: the list is polled, so a terminal url can
  // be open before its meta has arrived — and a sidecar written before projectName
  // existed leaves it undefined at runtime despite the type.
  if (view.kind === "session") return session?.projectName?.trim() || null;
  return soleProject(filters.project);
}

/**
 * The one project a multi-select filter names, or null when it names none or several.
 *
 * A sheet's Project field holds exactly one value, so a board filtered on three
 * projects has no answer to give it (RIC-225) — and picking one of the three would put
 * the ticket, or the session's cwd, in a repo the human never pointed at. "General
 * (home)" is the honest default there, and it is one tap from the right one.
 */
export function soleProject(projects: readonly string[]): string | null {
  return projects.length === 1 ? projects[0] : null;
}

/**
 * `candidate` if the server still offers it, else null.
 *
 * A session records the project it launched with; projects.json can have dropped it
 * since. A `<select>` whose value matches no `<option>` renders blank and submits
 * whatever the browser fell back to, so an unknown name has to become the explicit
 * "General (home)" instead.
 *
 * An empty `projects` is "not loaded yet", not "no projects exist": /api/projects
 * answers a render after the sheet opens, and resolving against that first empty pass
 * would throw the pre-selection away every time.
 */
export function knownProject(candidate: string | null, projects: string[]): string | null {
  if (candidate === null) return null;
  if (projects.length === 0) return candidate;
  return projects.includes(candidate) ? candidate : null;
}
