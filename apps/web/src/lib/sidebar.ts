import type { ProjectRow, SessionMeta, TicketSummary } from "@mojito/shared";
import { byProjectName } from "@/lib/board";

export interface SidebarGroup {
  /** `null` is General: sessions with no (or no longer a configured) project. */
  project: string | null;
  sessions: SessionMeta[];
}

/**
 * The sessions grouped like the board's sections: configured projects alphabetically, General
 * last, empty groups dropped. A session stays until it is removed: within a group the live ones
 * come first, then the ended ones (to read back or Resume). Each part is newest `createdAt`
 * first, ties by id: both are fixed for a session's life, so a session asking for input never
 * jumps; one that ends moves down once, and a Resume brings it back to the top.
 */
export function sidebarGroups(projects: Pick<ProjectRow, "name">[], sessions: SessionMeta[]): SidebarGroup[] {
  const names = projects.map((p) => p.name).sort(byProjectName);
  const known = new Set(names);
  const ordered = [...sessions].sort(
    (a, b) =>
      Number(a.state === "ended") - Number(b.state === "ended") || b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  );

  return [...names, null]
    .map((project) => ({
      project,
      sessions: ordered.filter((s) => (s.project !== null && known.has(s.project) ? s.project : null) === project),
    }))
    .filter((g) => g.sessions.length > 0);
}

/** The session whose terminal is on screen: the same id on two instances is two sessions. */
export interface CurrentSession {
  /** The peer's name, `null` for this instance. */
  host: string | null;
  id: string;
}

export function isCurrent(current: CurrentSession | undefined, host: string | null, id: string): boolean {
  return current !== undefined && current.host === host && current.id === id;
}

/** How many live sessions the groups hold: the count on a host's band (ended ones are history). */
export function sessionCount(groups: SidebarGroup[]): number {
  return groups.reduce((n, g) => n + g.sessions.filter((s) => s.state !== "ended").length, 0);
}

/**
 * A row's two lines: the ticket id and its title from the tickets cache (empty when the
 * ticket is no longer listed), or the session's name (`sessionName`) and the id's hex suffix.
 */
export function sessionLabel(
  s: SessionMeta,
  tickets: Pick<TicketSummary, "identifier" | "title">[],
): { primary: string; secondary: string } {
  if (s.kind === "ticket" && s.ticket !== null) {
    return { primary: s.ticket, secondary: tickets.find((t) => t.identifier === s.ticket)?.title ?? "" };
  }
  return { primary: sessionName(s), secondary: s.id.slice(s.id.lastIndexOf("-") + 1) };
}

/**
 * What a session with no ticket is called: claude's name for it (`/rename`, else its automatic
 * title, read from tmux by the server), else its kind. A ticket session is called by its ticket.
 */
export function sessionName(s: SessionMeta): string {
  return s.title ?? (s.kind === "shell" ? "Shell" : "Claude");
}
