/**
 * The whole prompt a ticket session starts with. It names the ticket and nothing else:
 * the session reads the issue — and moves it to In Review — through the Linear MCP of the
 * user's own Claude Code, so there is no ticket text, context file or result file here.
 * A test fixes both variants byte for byte.
 */
export function buildTicketPrompt(ticket: string, brainstorming: boolean): string {
  const lines = [`Leggi il ticket ${ticket} da Linear ed eseguilo.`];
  if (brainstorming) lines.push("Prima di implementare, usa la skill superpowers:brainstorming.");
  lines.push('Quando il lavoro è pronto per la revisione, sposta il ticket in "In Review" su Linear.');
  return lines.join("\n");
}
