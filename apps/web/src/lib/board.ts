import type { BoardTickets, ProjectRow, SessionMeta, TicketSummary } from "@mojito/shared";
import type { BoardFilters } from "@/lib/filters";

/** Board order of the active statuses; any other non-Backlog status sorts after the last of these. */
export const STATUS_ORDER = ["In Review", "In Progress", "Todo"];

export interface BoardSection {
  /** `null` is the General section: loose sessions with no (or no longer a mapped) project. */
  project: string | null;
  active: TicketSummary[];
  backlog: TicketSummary[];
  /** Whether the Backlog group starts open: a Backlog status filter or a search is looking inside it. */
  backlogOpen: boolean;
  /**
   * Sessions with no ticket card to hang off, newest first: free sessions, and ticket sessions
   * whose ticket is not on the board (Done, Canceled, moved to another project, past the
   * query's first 100). A live tmux must never vanish from the board just because Linear
   * stopped listing its ticket.
   */
  loose: SessionMeta[];
}

function statusRank(statusName: string): number {
  const i = STATUS_ORDER.indexOf(statusName);
  return i === -1 ? STATUS_ORDER.length : i;
}

/** Display order of project names (sections, sidebar groups, the filter sheet): a fixed locale, the same on every device. */
export const byProjectName = (a: string, b: string): number => a.localeCompare(b, "en");

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
 * no ticket and no loose session is dropped. Tickets are placed by their own project name;
 * a loose session whose project is no longer mapped lands in General rather than vanishing.
 * "On the board" means shown: a ticket whose project is not mapped gets no card, so its
 * session is loose too.
 */
export function groupBoard(
  projects: ProjectRow[],
  tickets: TicketSummary[],
  sessions: SessionMeta[],
): BoardSection[] {
  const names = projects.map((p) => p.name).sort(byProjectName);
  const known = new Set(names);
  const carded = new Set(tickets.filter((t) => t.project !== null && known.has(t.project)).map((t) => t.identifier));
  const looseSessions = sessions
    .filter((s) => s.kind !== "ticket" || s.ticket === null || !carded.has(s.ticket))
    .sort((a, b) => b.createdAt - a.createdAt);

  const section = (project: string | null): BoardSection => {
    const own = project === null ? [] : tickets.filter((t) => t.project === project);
    return {
      project,
      active: own.filter((t) => t.statusName !== "Backlog").sort(byStatusThenIdentifier),
      backlog: own.filter((t) => t.statusName === "Backlog").sort(byIdentifier),
      backlogOpen: false,
      loose: looseSessions.filter((s) => (s.project !== null && known.has(s.project) ? s.project : null) === project),
    };
  };

  return [...names, null]
    .map(section)
    .filter((s) => s.active.length + s.backlog.length + s.loose.length > 0);
}

/**
 * The board narrowed by the url filters, after `groupBoard`. A project filter keeps those
 * sections (General never matches one). A status filter keeps those active tickets (any status
 * outside `FILTER_STATUSES` is hidden with it), shows Backlog only if selected, and hides
 * loose sessions, which have no status. `q` matches ticket identifier, title and labels, and
 * loose sessions by ticket, id or kind. A section left empty is dropped.
 */
export function filterBoard(sections: BoardSection[], f: BoardFilters): BoardSection[] {
  const q = f.q.trim().toLowerCase();
  const hasStatus = f.statuses.length > 0;
  const has = (text: string) => text.toLowerCase().includes(q);
  const ticketMatches = (t: TicketSummary) =>
    q === "" || has(t.identifier) || has(t.title) || t.labels.some(has);
  const sessionMatches = (s: SessionMeta) => q === "" || has(s.ticket ?? "") || has(s.id) || has(s.kind);
  const backlogShown = !hasStatus || f.statuses.includes("Backlog");

  return sections
    .filter((s) => f.projects.length === 0 || (s.project !== null && f.projects.includes(s.project)))
    .map((s) => {
      const backlog = backlogShown ? s.backlog.filter(ticketMatches) : [];
      return {
        project: s.project,
        active: s.active.filter(
          (t) => (!hasStatus || f.statuses.includes(t.statusName)) && ticketMatches(t),
        ),
        backlog,
        backlogOpen: backlog.length > 0 && (f.statuses.includes("Backlog") || q !== ""),
        loose: hasStatus ? [] : s.loose.filter(sessionMatches),
      };
    })
    .filter((s) => s.active.length + s.backlog.length + s.loose.length > 0);
}

/** The board's kanban columns, in workflow order left to right (the list reads the other way: STATUS_ORDER). */
export const KANBAN_ORDER = ["Todo", "In Progress", "In Review"] as const;

export interface KanbanColumn {
  /** A status of `KANBAN_ORDER`, or "Other" for any status outside it. */
  status: string;
  tickets: TicketSummary[];
}

/**
 * A section's active tickets as kanban columns, each keeping the section's order. Every column
 * of `KANBAN_ORDER` is there even when empty — the columns line up across projects — unless a
 * status filter leaves it out; an "Other" column (a custom Linear status) only when it has a ticket.
 */
export function kanbanColumns(active: TicketSummary[], statusFilter: readonly string[]): KanbanColumn[] {
  const known: readonly string[] = KANBAN_ORDER;
  const columns: KanbanColumn[] = KANBAN_ORDER.filter((s) => statusFilter.length === 0 || statusFilter.includes(s)).map(
    (status) => ({ status, tickets: active.filter((t) => t.statusName === status) }),
  );
  const others = active.filter((t) => !known.includes(t.statusName));
  if (others.length > 0) columns.push({ status: "Other", tickets: others });
  return columns;
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
  if (t.fetchedAt !== null) return `Linear unreachable — data from ${clock(t.fetchedAt)}`;
  return t.error ? `Linear unreachable: ${t.error}` : "Linear unreachable";
}
