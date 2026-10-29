import { z } from "zod";

/** Where the ticket prompt names the ticket; replaced with its identifier at launch. */
export const TICKET_PLACEHOLDER = "{ticket}";

/**
 * The create-ticket agent's default instructions: the old app's intake prompt
 * (`src/server/prompts/intake.ts`), adapted to a headless agent: the note arrives in the user
 * message rather than in a draft file, Linear is reached through Mojito's own
 * `list_labels`/`create_issue` tools rather than the Linear MCP, and there is no terminal to
 * ask in — a vague note becomes a ticket faithful to what it says. Priority is left unsaid on
 * purpose, as it was there: a note that does not raise urgency gets no guessed one. One line per
 * paragraph: the text is edited in a textarea, where hard wraps would turn ragged.
 */
const CREATE_TICKET = `You are turning a rough note into a Linear issue. A human just typed it into Mojito's New-ticket sheet; nothing has been created yet.

The user message carries the note, the Linear team and the project it belongs to, and any images attached to it.

Rewrite the note into a ticket someone else could pick up: fix the spelling and the grammar, give it whatever structure fits what it actually is, and keep every concrete detail the note carries. Do not invent requirements, do not design the solution, and do not go reading the repository — the note is all there is. Then give it a title: one line, specific, no ticket id. Title and description both go in Italian, whatever language the note itself is written in.

If the note plainly is one of \`Bug\`, \`Improvement\`, \`Feature\`, label it with that one: never more than one, and no label at all when none of the three fits — a ticket without a label is fine. \`list_labels\` answers the team's labels with their ids; pass the one you picked as \`labelId\`. A label is also where that belongs, so the description gets no heading naming it: a bug report opens with the problem, not with a "Bug" title.

Create the issue with \`create_issue\`, once, on the team and the project the message names. Then print the identifier and the url of what you created and stop — there is nothing to implement here.

Do not ask questions: if the note is vague, create a ticket faithful to what it says.`;

/**
 * What Mojito says to Claude, as shipped; Settings can override each one. The ticket prompt is
 * the whole instruction a ticket session starts with: it names the ticket and nothing else —
 * the session reads the issue, and moves it to In Review, through the Linear MCP of the user's
 * own Claude Code. Whether to brainstorm is the session's call, not a launch option.
 */
export const DEFAULT_PROMPTS = {
  ticket: [
    `Read ticket ${TICKET_PLACEHOLDER} from Linear and carry it out.`,
    "If the ticket leaves design decisions open, use the superpowers:brainstorming skill before implementing; if it is already clear and specific, skip it.",
    'When the work is ready for review, move the ticket to "In Review" on Linear.',
  ].join("\n"),
  createTicket: CREATE_TICKET,
};

export type PromptKey = keyof typeof DEFAULT_PROMPTS;
export type Prompts = Record<PromptKey, string>;

export const PromptsBody = z.object({
  ticket: z.string().refine((s) => s.includes(TICKET_PLACEHOLDER), {
    message: `Must contain ${TICKET_PLACEHOLDER}, where the ticket id goes.`,
  }),
  createTicket: z.string().refine((s) => s.trim() !== "", { message: "Must not be empty." }),
});
