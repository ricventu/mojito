import type { SessionMeta } from "@/server/types";
import { statusRank } from "@/lib/status";
import { NO_PROJECT } from "@/lib/ticketFilter";

/**
 * Distinct launch statuses present in the sessions, ordered by lifecycle rank
 * (unknown statuses last, alphabetical tie-break — same ordering as ticketStatuses).
 * Custom sessions have no launch status (empty string) and are excluded.
 */
export function sessionStatuses(sessions: SessionMeta[]): string[] {
  return Array.from(new Set(sessions.map((s) => s.launchStatus).filter((v) => v !== "")))
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
    if (status !== null && s.launchStatus !== status) return false;
    if (!q) return true;
    return [s.ticket, s.launchStatus, s.model, s.message, s.title]
      .some((v) => v?.toLowerCase().includes(q));
  });
}
