import { WORK_STATES } from "./statusModel.js";

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

export function tmuxName(ticket: string, status: string): string {
  validateTicket(ticket);
  // The work states (Backlog/Todo/In Progress) share one session id: a launch-time board
  // move (Backlog/Todo -> In Progress) must not change the session's tmux name mid-flight,
  // or the duplicate guard and "open running session" lookup both miss the live session.
  const slug = WORK_STATES.includes(status) ? "work" : statusSlug(status);
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
