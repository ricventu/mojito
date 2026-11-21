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
