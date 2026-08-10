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

/**
 * Distinct project names across tickets and sessions, with NO_PROJECT for either
 * side's blanks.
 *
 * `tickets` is the mine-scoped list, same as mergedStatuses: sessions are not scoped
 * by Mine, so the full list comes in.
 */
export function mergedProjects(tickets: TicketSummary[], sessions: SessionMeta[]): string[] {
  return Array.from(new Set([
    ...tickets.map((t) => t.project ?? NO_PROJECT),
    ...sessions.map((s) => s.projectName ?? NO_PROJECT),
  ])).sort();
}

/** A project's ticket rows and loose sessions, bucketed for the unified list's sections. */
export interface ProjectSection {
  project: string;
  ticketRows: TicketRow[];
  sessions: SessionMeta[];
}

/**
 * Buckets ticket rows and loose sessions by project, in encounter order — tickets
 * first, so a project that only holds a loose session still gets its own section,
 * appended after the ones that also have tickets. This is what keeps "a project
 * section is never lost" true: every ticket row and every loose session lands in
 * exactly one section, and a project is never dropped just because one side has
 * nothing for it.
 *
 * Both sides key on the same sentinel — `row.ticket.project ?? NO_PROJECT` and
 * `ssn.projectName ?? NO_PROJECT` — so a null-project ticket and a null-project
 * session land in the same NO_PROJECT section. Item order within a section is the
 * input order; sorting is the caller's job (see orderTicketRows, orderSessions).
 * Does not mutate its inputs.
 */
export function groupByProject(
  ticketRows: TicketRow[],
  looseSessions: SessionMeta[],
): ProjectSection[] {
  const sections = new Map<string, ProjectSection>();
  const order: string[] = [];
  const sectionFor = (name: string): ProjectSection => {
    let section = sections.get(name);
    if (!section) {
      section = { project: name, ticketRows: [], sessions: [] };
      sections.set(name, section);
      order.push(name);
    }
    return section;
  };
  for (const row of ticketRows) {
    sectionFor(row.ticket.project ?? NO_PROJECT).ticketRows.push(row);
  }
  for (const ssn of looseSessions) {
    sectionFor(ssn.projectName ?? NO_PROJECT).sessions.push(ssn);
  }
  return order.map((name) => sections.get(name)!);
}
