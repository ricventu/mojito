import { DEFAULT_PROMPTS, TICKET_PLACEHOLDER } from "@mojito/shared";

/**
 * The whole prompt a ticket session starts with: the ticket prompt from Settings (the shipped
 * one by default, see `DEFAULT_PROMPTS`) with every `{ticket}` replaced by the identifier.
 * A test fixes the default's text byte for byte.
 */
export function buildTicketPrompt(ticket: string, template: string = DEFAULT_PROMPTS.ticket): string {
  // split/join rather than replaceAll with a string: the identifier is inserted literally.
  return template.split(TICKET_PLACEHOLDER).join(ticket);
}
