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
  return `mojito-${ticket}-${statusSlug(status)}`;
}

export function customSessionName(slug: string, unique: string): string {
  return `mojito-custom-${slug}-${unique}`;
}
