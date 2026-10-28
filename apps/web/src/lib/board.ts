import type { BoardTickets, ProjectRow, SessionMeta, TicketSummary } from "@mojito/shared";

/** Board order of the active statuses; any other non-Backlog status sorts after the last of these. */
export const STATUS_ORDER = ["In Review", "In Progress", "Todo"];

export interface BoardSection {
  /** `null` is the General section: free sessions with no (or no longer a mapped) project. */
  project: string | null;
  active: TicketSummary[];
  backlog: TicketSummary[];
  free: SessionMeta[];
}

function statusRank(statusName: string): number {
  const i = STATUS_ORDER.indexOf(statusName);
  return i === -1 ? STATUS_ORDER.length : i;
}

/** The number after the last dash, so RIC-9 sorts before RIC-10. */
function ticketNumber(identifier: string): number {
  return Number(identifier.slice(identifier.lastIndexOf("-") + 1)) || 0;
}

function byIdentifier(a: TicketSummary, b: TicketSummary): number {
  const prefixA = a.identifier.slice(0, a.identifier.lastIndexOf("-"));
  const prefixB = b.identifier.slice(0, b.identifier.lastIndexOf("-"));
  return prefixA.localeCompare(prefixB) || ticketNumber(a.identifier) - ticketNumber(b.identifier);
}

function byStatusThenIdentifier(a: TicketSummary, b: TicketSummary): number {
  return statusRank(a.statusName) - statusRank(b.statusName) || byIdentifier(a, b);
}

/**
 * One section per configured project (alphabetical), then General last. A section with
 * no ticket and no free session is dropped. Tickets are placed by their own project name;
 * a free session whose project is no longer mapped lands in General rather than vanishing.
 */
export function groupBoard(
  projects: ProjectRow[],
  tickets: TicketSummary[],
  sessions: SessionMeta[],
): BoardSection[] {
  const names = projects.map((p) => p.name).sort((a, b) => a.localeCompare(b));
  const known = new Set(names);
  const freeSessions = sessions
    .filter((s) => s.kind !== "ticket")
    .sort((a, b) => b.createdAt - a.createdAt);

  const section = (project: string | null): BoardSection => {
    const own = project === null ? [] : tickets.filter((t) => t.project === project);
    return {
      project,
      active: own.filter((t) => t.statusName !== "Backlog").sort(byStatusThenIdentifier),
      backlog: own.filter((t) => t.statusName === "Backlog").sort(byIdentifier),
      free: freeSessions.filter((s) => (s.project !== null && known.has(s.project) ? s.project : null) === project),
    };
  };

  return [...names, null]
    .map(section)
    .filter((s) => s.active.length + s.backlog.length + s.free.length > 0);
}

/** The ticket's live session if it has one, else the most recent one; `null` when it never had any. */
export function sessionForTicket(sessions: SessionMeta[], identifier: string): SessionMeta | null {
  const mine = sessions
    .filter((s) => s.ticket === identifier)
    .sort((a, b) => b.lastEventAt - a.lastEventAt);
  return mine.find((s) => s.state !== "ended") ?? mine[0] ?? null;
}

/** Sessions waiting on the human, the one waiting longest first. */
export function needsInput(sessions: SessionMeta[]): SessionMeta[] {
  return sessions.filter((s) => s.state === "needs-input").sort((a, b) => a.lastEventAt - b.lastEventAt);
}

/** Local HH:MM. */
export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The banner text for a failed Linear poll, or `null` when the list is fresh. */
export function linearBanner(t: BoardTickets): string | null {
  if (!t.stale && !t.error) return null;
  if (t.fetchedAt !== null) return `Linear non raggiungibile — dati delle ${clock(t.fetchedAt)}`;
  return t.error ? `Linear non raggiungibile: ${t.error}` : "Linear non raggiungibile";
}
