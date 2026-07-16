import type { TicketSummary } from "@/server/types";
import { statusRank } from "@/lib/status";

/** Sentinel project name for tickets/sessions that have no Linear project. */
export const NO_PROJECT = "No project";

/**
 * Distinct lifecycle statuses present in the tickets, ordered by lifecycle rank
 * (unknown statuses last, alphabetical tie-break — same ordering as groupByStatus).
 */
export function ticketStatuses(tickets: TicketSummary[]): string[] {
  return Array.from(new Set(tickets.map((t) => t.statusName))).sort((a, b) => {
    const byRank = statusRank(a) - statusRank(b);
    return byRank !== 0 ? byRank : a.localeCompare(b);
  });
}

export interface TicketFilter {
  query: string;
  project: string | null;
  status: string | null;
}

/** Tickets matching all active criteria (project AND status AND query). */
export function filterTickets(
  tickets: TicketSummary[],
  { query, project, status }: TicketFilter,
): TicketSummary[] {
  const q = query.trim().toLowerCase();
  return tickets.filter((t) => {
    if (project !== null && (t.project ?? NO_PROJECT) !== project) return false;
    if (status !== null && t.statusName !== status) return false;
    if (!q) return true;
    return [t.identifier, t.title, t.statusName, ...t.labels]
      .some((v) => v.toLowerCase().includes(q));
  });
}
