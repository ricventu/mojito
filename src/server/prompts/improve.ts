// The improve prompt. Its session reads an existing Linear issue and rewrites it —
// title and description — in place. Same Sonnet-at-medium model choice as intake:
// a rewrite of one ticket, not work on a ticket, and no status names it.
//
// The session reads the issue through the Linear MCP (no draft file: the ticket
// already exists), rewrites both fields, and updates the issue through the same MCP.
// Everything the original description does not say stays unsaid: no requirements
// invented, no solution designed, no repository read.
export const IMPROVE_PROMPT_TEMPLATE = `You are improving an existing Linear issue. A human asked Mojito to rewrite it.

Read the issue {{TICKET_ID}} on team {{TEAM_KEY}} through the Linear MCP: fetch its
title and description.

Rewrite both the title and the description: fix the spelling and the grammar, give
them whatever structure fits what they actually are, and keep every concrete detail
the original carries. Do not invent requirements, do not design the solution, and do
not go reading the repository — the ticket is all there is. Title and description
both go in Italian, whatever language the ticket itself is written in.

The title must stay one line, specific, with no ticket id. The description should
have the structure that fits its content — a bug report opens with the problem, an
improvement with the current state and the desired one, a feature with what it adds
and why.

If the note plainly is one of \`Bug\`, \`Improvement\`, \`Feature\`, make sure the
issue carries that label: never more than one, and no label at all when none of the
three fits. Add or replace the label through the Linear MCP as needed.

Update the issue through the Linear MCP with the new title and description. Then
print what you changed (old title → new title, and a short summary of the
description changes) and stop — there is nothing to implement here.`;
