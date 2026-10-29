import type { ProjectRow, SessionMeta, TicketSummary } from "@mojito/shared";
import { byProjectName } from "@/lib/board";

export interface SidebarGroup {
  /** `null` is General: sessions with no (or no longer a configured) project. */
  project: string | null;
  sessions: SessionMeta[];
}

/**
 * The live sessions grouped like the board's sections: configured projects alphabetically,
 * General last, empty groups dropped. `ended` is sticky, so a row only appears on a launch
 * and leaves on a removal. Within a group the order is newest `createdAt`, ties by id: both
 * are immutable for a session's life, so a session asking for input never jumps.
 */
export function sidebarGroups(projects: ProjectRow[], sessions: SessionMeta[]): SidebarGroup[] {
  const names = projects.map((p) => p.name).sort(byProjectName);
  const known = new Set(names);
  const live = sessions
    .filter((s) => s.state !== "ended")
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  return [...names, null]
    .map((project) => ({
      project,
      sessions: live.filter((s) => (s.project !== null && known.has(s.project) ? s.project : null) === project),
    }))
    .filter((g) => g.sessions.length > 0);
}

/** The groups without and with hidden sessions; both halves keep the grouping, empty groups dropped. */
export function splitHidden(groups: SidebarGroup[]): { shown: SidebarGroup[]; hidden: SidebarGroup[] } {
  const part = (hidden: boolean): SidebarGroup[] =>
    groups
      .map((g) => ({ project: g.project, sessions: g.sessions.filter((s) => s.hidden === hidden) }))
      .filter((g) => g.sessions.length > 0);
  return { shown: part(false), hidden: part(true) };
}

/**
 * A row's two lines: the ticket id and its title from the tickets cache (empty when the
 * ticket is no longer listed), or Claude/Shell and the id's hex suffix.
 */
export function sessionLabel(
  s: SessionMeta,
  tickets: TicketSummary[],
): { primary: string; secondary: string } {
  if (s.kind === "ticket" && s.ticket !== null) {
    return { primary: s.ticket, secondary: tickets.find((t) => t.identifier === s.ticket)?.title ?? "" };
  }
  return {
    primary: s.kind === "shell" ? "Shell" : "Claude",
    secondary: s.id.slice(s.id.lastIndexOf("-") + 1),
  };
}
