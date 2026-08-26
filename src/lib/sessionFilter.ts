import type { SessionMeta } from "@/server/types";
import { statusRank, CUSTOM_STATUS, INTAKE_STATUS, TERMINAL_STATUS } from "@/lib/status";
import { NO_PROJECT, type LiveStatuses } from "@/lib/ticketFilter";

/**
 * Synthetic status buckets for sessions with no Linear launch status: CUSTOM_STATUS
 * for custom (bare claude) sessions, INTAKE_STATUS for the New-ticket session and
 * TERMINAL_STATUS for shell (plain terminal) sessions. Used both as status-filter options
 * and as group-divider labels so those sessions are filterable and visually separated
 * like lifecycle statuses.
 * Defined in status.ts (each with its hue) and re-exported here for filter callers.
 */
export { CUSTOM_STATUS, INTAKE_STATUS, TERMINAL_STATUS };

/**
 * Effective status of a session for grouping/filtering: the kinds with no launch status
 * bucket under their synthetic one (CUSTOM_STATUS, INTAKE_STATUS, TERMINAL_STATUS);
 * others use their launch status.
 *
 * `live` (see liveStatuses) makes that last part honest. `launchStatus` is written once
 * at launch and never again, so a session launched from Todo still says Todo after the
 * ticket reached To QA — which put the session under a Todo status chip its own ticket
 * no longer matched, orphaning it into the "No ticket" group. The ticket's current
 * status wins whenever the ticket is among the known ones; a session whose ticket is
 * not (never fetched, or gone) keeps the launch status as its only answer.
 */
export function sessionStatus(s: SessionMeta, live?: LiveStatuses): string {
  if (s.kind === "custom") return CUSTOM_STATUS;
  // An intake session is mechanically a custom one, but it is the only session on the
  // board Mojito started on the human's behalf rather than at their pick — so it says
  // what it is instead of sitting in Custom with no way to tell it apart (RIC-251).
  if (s.kind === "intake") return INTAKE_STATUS;
  if (s.kind === "shell") return TERMINAL_STATUS;
  return live?.get(s.ticket) ?? s.launchStatus;
}

/**
 * Distinct statuses present in the sessions, ordered by lifecycle rank (unknown
 * statuses — including the three synthetic buckets — last, alphabetical tie-break).
 * Custom, intake and shell sessions surface under their own bucket rather than being
 * dropped.
 */
export function sessionStatuses(sessions: SessionMeta[], live?: LiveStatuses): string[] {
  return Array.from(new Set(sessions.map((s) => sessionStatus(s, live)).filter((v) => v !== "")))
    .sort((a, b) => {
      const byRank = statusRank(a) - statusRank(b);
      return byRank !== 0 ? byRank : a.localeCompare(b);
    });
}

export interface SessionFilter {
  query: string;
  /** The selected projects; empty is every project — see ListFilters. */
  project: string[];
  status: string | null;
}

/** Sessions matching all active criteria (project AND status AND query). */
export function filterSessions(
  sessions: SessionMeta[],
  { query, project, status }: SessionFilter,
  live?: LiveStatuses,
): SessionMeta[] {
  const q = query.trim().toLowerCase();
  return sessions.filter((s) => {
    if (project.length > 0 && !project.includes(s.projectName ?? NO_PROJECT)) return false;
    if (status !== null && sessionStatus(s, live) !== status) return false;
    if (!q) return true;
    return [s.ticket, s.launchStatus, s.model, s.message, s.title]
      .some((v) => v?.toLowerCase().includes(q));
  });
}
