/**
 * The whole prompt a ticket session starts with. It names the ticket and nothing else:
 * the session reads the issue — and moves it to In Review — through the Linear MCP of the
 * user's own Claude Code, so there is no ticket text, context file or result file here.
 * Whether to brainstorm is the session's call, made from the ticket, not a launch option.
 * A test fixes the text byte for byte.
 */
export function buildTicketPrompt(ticket: string): string {
  return [
    `Read ticket ${ticket} from Linear and carry it out.`,
    "If the ticket leaves design decisions open, use the superpowers:brainstorming skill before implementing; if it is already clear and specific, skip it.",
    'When the work is ready for review, move the ticket to "In Review" on Linear.',
  ].join("\n");
}
