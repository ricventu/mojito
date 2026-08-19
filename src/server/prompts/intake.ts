// The intake prompt. Its session exists to create a Linear issue out of a note a human
// typed into Mojito's New-ticket sheet, so it is the one prompt that talks about Linear
// on purpose (RIC-184 governs the work and merge-fix prompts, which have a ticket already
// and nothing to create). Mojito cannot create the issue itself here — the title and the
// description are exactly what the session is being asked to produce.
//
// Everything the note does not say stays unsaid: no requirements invented, no solution
// designed, no repository read. A vague note comes back as a question in the terminal,
// which is also where the MCP write asks for permission — that prompt is the human's
// last look before the issue exists.
export const INTAKE_PROMPT_TEMPLATE = `You are turning a rough note into a Linear issue. A human just typed it into Mojito's
New-ticket sheet; nothing has been created yet.

Read the JSON draft at {{DRAFT_PATH}}: \`brief\` is the raw note, \`imageUrls\` are the
images attached to it — Mojito has already uploaded those to Linear, so they are ready to
embed as \`![](url)\` markdown and there is nothing for you to upload.

Rewrite the brief into a ticket someone else could pick up: fix the spelling and the
grammar, give it whatever structure fits what it actually is, and keep every concrete
detail the note carries. Do not invent requirements, do not design the solution, and do
not go reading the repository — the note is all there is. Then give it a title: one line,
specific, no ticket id. Title and description both go in Italian, whatever language the
note itself is written in.

Create the issue with the Linear MCP, on team {{TEAM_KEY}}, {{PROJECT_CLAUSE}}. Put the
image markdown at the end of the description. Then print the identifier and the url of
what you created and stop — there is nothing to implement here.

If the note is too vague to become a ticket on its own, ask in this terminal before
creating anything.`;
