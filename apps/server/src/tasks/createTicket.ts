import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { isImageType } from "./images";

/**
 * The old app's intake prompt (`src/server/prompts/intake.ts`), adapted to a headless agent:
 * the note arrives in the user message rather than in a draft file, Linear is reached through
 * Mojito's own `list_labels`/`create_issue` tools rather than the Linear MCP, and there is no
 * terminal to ask in — a vague note becomes a ticket faithful to what it says. Priority is left
 * unsaid on purpose, as it was there: a note that does not raise urgency gets no guessed one.
 */
export const CREATE_TICKET_SYSTEM = `You are turning a rough note into a Linear issue. A human just typed it into Mojito's
New-ticket sheet; nothing has been created yet.

The user message carries the note, the Linear team and the project it belongs to, and any
images attached to it.

Rewrite the note into a ticket someone else could pick up: fix the spelling and the
grammar, give it whatever structure fits what it actually is, and keep every concrete
detail the note carries. Do not invent requirements, do not design the solution, and do
not go reading the repository — the note is all there is. Then give it a title: one line,
specific, no ticket id. Title and description both go in Italian, whatever language the
note itself is written in.

If the note plainly is one of \`Bug\`, \`Improvement\`, \`Feature\`, label it with that one:
never more than one, and no label at all when none of the three fits — a ticket without a
label is fine. \`list_labels\` answers the team's labels with their ids; pass the one you
picked as \`labelId\`. A label is also where that belongs, so the description gets no
heading naming it: a bug report opens with the problem, not with a "Bug" title.

Create the issue with \`create_issue\`, once, on the team and the project the message
names. Then print the identifier and the url of what you created and stop — there is
nothing to implement here.

Non fare domande: se la nota è vaga, crea un ticket fedele a ciò che dice.`;

/**
 * Only with images (cf. `INTAKE_IMAGES_PARAGRAPH`): told to embed an empty list, a model either
 * goes looking for images that do not exist or leaves an empty attachments heading behind.
 */
const imagesParagraph = (urls: string[]) =>
  `Le immagini allegate a questo messaggio sono quelle allegate alla nota. Mojito le ha già
caricate su Linear, quindi non c'è nulla da caricare: incorporale in fondo alla
descrizione come markdown, esattamente così:

${urls.map((u) => `![](${u})`).join("\n")}`;

export function buildCreateTicketMessage(
  input: { teamKey: string; project: string; note: string; imageUrls: string[] },
  images: { mediaType: string; base64: string }[],
): SDKUserMessage {
  const parts = [`Team: ${input.teamKey}\nProgetto: ${input.project}\n\nNota:\n${input.note}`];
  if (input.imageUrls.length > 0) parts.push(imagesParagraph(input.imageUrls));
  // An image whose download came back with a type the API does not take is left out of the
  // model's view; its url is still embedded in the description.
  const imageBlocks = images.flatMap((img) =>
    isImageType(img.mediaType) ? [{ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 } }] : [],
  );
  return {
    type: "user",
    parent_tool_use_id: null,
    message: { role: "user", content: [...imageBlocks, { type: "text", text: parts.join("\n\n") }] },
  };
}
