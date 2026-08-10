import type { SessionMeta, TicketSummary } from "@/server/types";
import { filterTickets } from "@/lib/ticketFilter";
import { filterSessions } from "@/lib/sessionFilter";
import { orderSessions } from "@/lib/orderSessions";
import { orderTickets } from "@/lib/orderTickets";
import { isActiveSession } from "@/lib/activeSession";

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
 * The loose set is what makes the merge safe: a session whose ticket is hidden by the
 * query, a status chip or Mine is not nested anywhere, so instead of disappearing it
 * falls through to "No ticket" — where its card still shows the ticket identifier.
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

  // Sessions that lost their row. A session with no ticket at all (custom/shell) was
  // never a nesting candidate; filter it exactly like the old session list did —
  // project, status and query all apply to its own fields (see the last test in the
  // "filters loose sessions by project and query" case).
  //
  // A session that DOES reference a ticket lost its row only because that ticket
  // failed filterTickets — which may have been the query, matched against the
  // ticket's own text (identifier/title/labels), not the session's. A text mismatch
  // there says nothing about the session, so the query is not re-applied to it: that
  // would silently violate the "no session vanishes" invariant (see "keeps a session
  // loose when the query hides its ticket"). Project and status are still re-applied
  // on the session's own merits, since those are exact-match criteria that make sense
  // per-entity — the ticket has moved on and the session's launchStatus is a snapshot
  // of history (see "drops a session the status chip excludes on its own merits").
  const orphaned = sessions.filter((s) => !nested.has(s.id));
  const keptIds = new Set([
    ...filterSessions(orphaned.filter((s) => s.ticket !== ""), { ...filter, query: "" }),
    ...filterSessions(orphaned.filter((s) => s.ticket === ""), filter),
  ].map((s) => s.id));
  let looseSessions = orphaned.filter((s) => keptIds.has(s.id));

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
