import type { SessionMeta } from "@/server/types";
import { statusRank, CUSTOM_STATUS } from "@/lib/status";
import { NO_PROJECT } from "@/lib/ticketFilter";

/**
 * Synthetic status bucket for custom sessions, which have no Linear launch status.
 * Used both as a status-filter option and as the group-divider label so custom
 * sessions are filterable and visually separated like lifecycle statuses.
 * Defined in status.ts (with its hue) and re-exported here for filter callers.
 */
export { CUSTOM_STATUS };

/**
 * Effective status of a session for grouping/filtering: custom sessions have no
 * launch status, so they bucket under CUSTOM_STATUS; others use their launch status.
 */
export function sessionStatus(s: SessionMeta): string {
  return s.kind === "custom" ? CUSTOM_STATUS : s.launchStatus;
}

/**
 * Distinct statuses present in the sessions, ordered by lifecycle rank (unknown
 * statuses — including CUSTOM_STATUS — last, alphabetical tie-break). Custom
 * sessions surface as CUSTOM_STATUS rather than being dropped.
 */
export function sessionStatuses(sessions: SessionMeta[]): string[] {
  return Array.from(new Set(sessions.map(sessionStatus).filter((v) => v !== "")))
    .sort((a, b) => {
      const byRank = statusRank(a) - statusRank(b);
      return byRank !== 0 ? byRank : a.localeCompare(b);
    });
}

export interface SessionFilter {
  query: string;
  project: string | null;
  status: string | null;
}

/** Sessions matching all active criteria (project AND status AND query). */
export function filterSessions(
  sessions: SessionMeta[],
  { query, project, status }: SessionFilter,
): SessionMeta[] {
  const q = query.trim().toLowerCase();
  return sessions.filter((s) => {
    if (project !== null && (s.projectName ?? NO_PROJECT) !== project) return false;
    if (status !== null && sessionStatus(s) !== status) return false;
    if (!q) return true;
    return [s.ticket, s.launchStatus, s.model, s.message, s.title]
      .some((v) => v?.toLowerCase().includes(q));
  });
}
