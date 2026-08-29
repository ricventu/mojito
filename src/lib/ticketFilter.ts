import type { TicketSummary } from "@/server/types";
import { statusRank, BACKLOG_STATUS } from "@/lib/status";

/** Sentinel project name for tickets/sessions that have no Linear project. */
export const NO_PROJECT = "No project";

/**
 * Tickets assigned to the viewer, or all of them when the filter is off.
 *
 * This is a scope applied before the other criteria, not a fourth criterion inside
 * filterTickets: the project and status chips are derived from the scoped list, so
 * turning the filter on never leaves a chip that would match nothing.
 */
export function mineOnly(tickets: TicketSummary[], mine: boolean): TicketSummary[] {
  return mine ? tickets.filter((t) => t.assignedToMe) : tickets;
}

/**
 * Whether a ticket's card should carry the "assigned to me" marker.
 *
 * Only while the filter is off: with it on every visible ticket is the viewer's, so a
 * marker on all of them would carry no information.
 */
export function showsMineMarker(ticket: TicketSummary, mine: boolean): boolean {
  return !mine && ticket.assignedToMe;
}

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
  /** The selected projects; empty is every project — see ListFilters. */
  project: string[];
  status: string | null;
  /**
   * Whether Backlog tickets are shown (RIC-275). Optional, and absent means shown:
   * an omitted criterion narrows nothing, which is the convention `project: []` and
   * `status: null` already follow here. Note that ListFilters.backlog defaults the
   * other way — the *board* hides the Backlog, this function only obeys.
   */
  backlog?: boolean;
}

/** Tickets matching all active criteria (project AND status AND query AND backlog). */
export function filterTickets(
  tickets: TicketSummary[],
  { query, project, status, backlog = true }: TicketFilter,
): TicketSummary[] {
  const q = query.trim().toLowerCase();
  return tickets.filter((t) => {
    if (project.length > 0 && !project.includes(t.project ?? NO_PROJECT)) return false;
    if (status !== null && t.statusName !== status) return false;
    // Only while no status is selected: `status === BACKLOG_STATUS` is the chip's
    // "only" state, an explicit request for exactly these tickets, and every other
    // selection has already dropped them on the line above.
    if (status === null && !backlog && t.statusName === BACKLOG_STATUS) return false;
    if (!q) return true;
    return [t.identifier, t.title, t.statusName, ...t.labels]
      .some((v) => v.toLowerCase().includes(q));
  });
}

/**
 * A session's `launchStatus` is frozen at launch and never rewritten, so it goes stale
 * the moment Mojito moves the ticket on. This map — identifier → the ticket's current
 * status — is what lets the list read a session's status off its ticket instead.
 *
 * Build it from the *unscoped* ticket list: Mine is a scope over what the list shows,
 * not over what a status resolves to, so a ticket scoped out must still be able to
 * answer for its own sessions.
 */
export type LiveStatuses = ReadonlyMap<string, string>;

export function liveStatuses(tickets: TicketSummary[]): LiveStatuses {
  return new Map(tickets.map((t) => [t.identifier, t.statusName]));
}
