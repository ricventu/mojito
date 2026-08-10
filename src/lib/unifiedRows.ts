import type { SessionMeta, TicketSummary } from "@/server/types";
import { filterTickets, ticketStatuses, NO_PROJECT } from "@/lib/ticketFilter";
import { filterSessions, sessionStatuses } from "@/lib/sessionFilter";
import { orderSessions } from "@/lib/orderSessions";
import { orderTickets } from "@/lib/orderTickets";
import { isActiveSession } from "@/lib/activeSession";
import { statusRank } from "@/lib/status";

/** A ticket and the sessions that belong to it, rendered nested inside its card. */
export interface TicketRow {
  ticket: TicketSummary;
  sessions: SessionMeta[];
}

export interface UnifiedRows {
  ticketRows: TicketRow[];
  /** Sessions not nested under any visible ticket — the "No ticket" group. */
  looseSessions: SessionMeta[];
}

export interface UnifiedFilter {
  query: string;
  project: string | null;
  status: string | null;
}

/**
 * The unified list model: visible tickets with their sessions attached, plus every
 * session that did not find a home.
 *
 * `tickets` must already be scoped by mineOnly() — the Mine toggle is a scope, not a
 * criterion, so the chips can be derived from the scoped list (see mergedStatuses).
 *
 * The loose set is what makes the merge safe when something structural hides a ticket —
 * Mine scoping it out, or the ticket not being among the ones fetched. Its session is
 * nested nowhere, so instead of disappearing it falls through to "No ticket", where its
 * card still shows the ticket identifier.
 *
 * The loose set is still narrowed by the query, project and status chips on the session's
 * own fields, exactly as the old session list narrowed it. Neutralising the query here
 * would mean searching for one ticket dumped every other ticket's sessions into
 * "No ticket".
 */
export function buildUnifiedRows(
  { tickets, sessions, filter, sessionsOnly }: {
    tickets: TicketSummary[];
    sessions: SessionMeta[];
    filter: UnifiedFilter;
    sessionsOnly: boolean;
  },
): UnifiedRows {
  const visible = filterTickets(tickets, filter);
  const nested = new Set<string>();
  let ticketRows: TicketRow[] = visible.map((ticket) => {
    const own = sessions.filter((s) => s.ticket === ticket.identifier);
    for (const s of own) nested.add(s.id);
    return { ticket, sessions: orderSessions(own) };
  });
  let looseSessions = filterSessions(sessions.filter((s) => !nested.has(s.id)), filter);

  if (sessionsOnly) {
    ticketRows = ticketRows.filter((r) => r.sessions.some(isActiveSession));
    looseSessions = looseSessions.filter(isActiveSession);
  }
  return { ticketRows, looseSessions };
}

/**
 * Order ticket rows the way orderTickets orders tickets (newest identifier first,
 * numeric-aware), by delegating to it rather than restating the comparison.
 * Returns a new array; does not mutate the input.
 */
export function orderTicketRows(rows: TicketRow[]): TicketRow[] {
  const byId = new Map(rows.map((r) => [r.ticket.identifier, r]));
  return orderTickets(rows.map((r) => r.ticket)).map((t) => byId.get(t.identifier)!);
}

/**
 * Distinct statuses across tickets and sessions, ordered by lifecycle rank (unknown
 * ones — including the synthetic Custom and Terminal buckets — last, alphabetical
 * tie-break). Same comparison ticketStatuses and sessionStatuses each apply on their
 * own side, so a merged chip row stays in lifecycle order.
 *
 * `tickets` is the mine-scoped list, matching how the old ticket list derived its chips:
 * toggling Mine must never leave a chip that matches nothing. Sessions are not scoped
 * by Mine, so the full list comes in.
 */
export function mergedStatuses(tickets: TicketSummary[], sessions: SessionMeta[]): string[] {
  const all = new Set([...ticketStatuses(tickets), ...sessionStatuses(sessions)]);
  return Array.from(all)
    .filter((v) => v !== "")
    .sort((a, b) => {
      const byRank = statusRank(a) - statusRank(b);
      return byRank !== 0 ? byRank : a.localeCompare(b);
    });
}

/** Distinct project names across tickets and sessions, with NO_PROJECT for either side's blanks. */
export function mergedProjects(tickets: TicketSummary[], sessions: SessionMeta[]): string[] {
  return Array.from(new Set([
    ...tickets.map((t) => t.project ?? NO_PROJECT),
    ...sessions.map((s) => s.projectName ?? NO_PROJECT),
  ])).sort();
}
