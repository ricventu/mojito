import { WORK_STATES, GATE_STATES } from "./statusModel";

const TICKET_RE = /^([A-Z][A-Z0-9]*)-(\d+)$/;

export function validateTicket(ticket: string): void {
  if (!TICKET_RE.test(ticket)) throw new Error(`invalid ticket id: ${ticket}`);
}

export function parseIdentifier(ticket: string): { teamKey: string; number: number } {
  const m = TICKET_RE.exec(ticket);
  if (!m) throw new Error(`invalid ticket id: ${ticket}`);
  return { teamKey: m[1], number: Number(m[2]) };
}

export function statusSlug(status: string): string {
  return status
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// One id covers every status a work session can be launched from. Two reasons, both
// load-bearing: a launch-time board move (Backlog/Todo -> In Progress) must not change the
// session's tmux name mid-flight, and a session relaunched while the ticket sits at To QA
// (its predecessor died) must take the id that predecessor had. Otherwise the duplicate
// guard and the "open running session" lookup each see a different session for one ticket.
const WORK_ID_STATES = [...WORK_STATES, ...GATE_STATES];

export function tmuxName(ticket: string, status: string): string {
  validateTicket(ticket);
  const slug = WORK_ID_STATES.includes(status) ? "work" : statusSlug(status);
  return `mojito-${ticket}-${slug}`;
}

export function customSessionName(slug: string, unique: string): string {
  return `mojito-custom-${slug}-${unique}`;
}

export function shellSessionName(slug: string, unique: string): string {
  return `mojito-shell-${slug}-${unique}`;
}

export function stackSessionName(slug: string): string {
  return `stack-${slug}`;
}

// The conflict-resolution session Mojito launches when the QA-approve merge hits a
// conflict. Its own id so it never collides with the ticket's work session (which may
// still be registered) nor with the To QA gate id.
export function conflictSessionName(ticket: string): string {
  validateTicket(ticket);
  return `mojito-${ticket}-conflict`;
}
