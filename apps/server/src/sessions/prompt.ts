/**
 * The whole prompt a ticket session starts with. It names the ticket and nothing else:
 * the session reads the issue — and moves it to In Review — through the Linear MCP of the
 * user's own Claude Code, so there is no ticket text, context file or result file here.
 * A test fixes both variants byte for byte.
 */
export function buildTicketPrompt(ticket: string, brainstorming: boolean): string {
  const lines = [`Read ticket ${ticket} from Linear and carry it out.`];
  if (brainstorming) lines.push("Before implementing, use the superpowers:brainstorming skill.");
  lines.push('When the work is ready for review, move the ticket to "In Review" on Linear.');
  return lines.join("\n");
}
