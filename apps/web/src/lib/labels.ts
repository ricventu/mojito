import type { TicketSummary } from "@mojito/shared";

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/**
 * A label's Linear colour, or null (an older peer sends none). Checked again here: a peer's
 * tickets reach this client too, and the value goes into a style.
 */
export function labelColor(ticket: Pick<TicketSummary, "labelColors">, label: string): string | null {
  const colors = ticket.labelColors;
  if (!colors || !Object.hasOwn(colors, label)) return null;
  const color = colors[label];
  return typeof color === "string" && HEX_COLOR_RE.test(color) ? color.toLowerCase() : null;
}

export interface SheetLabel {
  name: string;
  color: string | null;
}

/**
 * The labels the filter sheet offers: every label on the loaded tickets, plus any selected one
 * no ticket carries any more (so it can still be turned off), each with the first valid colour
 * found, sorted for display.
 */
export function sheetLabels(tickets: TicketSummary[], selected: string[]): SheetLabel[] {
  const colors = new Map<string, string | null>();
  for (const t of tickets) {
    for (const label of t.labels) {
      if (!colors.get(label)) colors.set(label, labelColor(t, label));
    }
  }
  for (const label of selected) if (!colors.has(label)) colors.set(label, null);
  return [...colors]
    .map(([name, color]) => ({ name, color }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}
