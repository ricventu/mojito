import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { isImageType } from "./images";

/**
 * Only with images (cf. `INTAKE_IMAGES_PARAGRAPH`): told to embed an empty list, a model either
 * goes looking for images that do not exist or leaves an empty attachments heading behind.
 */
const imagesParagraph = (urls: string[]) =>
  `The images attached to this message are the ones attached to the note. Mojito has already
uploaded them to Linear, so there is nothing to upload: embed them at the end of the
description as markdown, exactly like this:

${urls.map((u) => `![](${u})`).join("\n")}`;

export function buildCreateTicketMessage(
  input: { teamKey: string; project: string; note: string; imageUrls: string[] },
  images: { mediaType: string; base64: string }[],
): SDKUserMessage {
  const parts = [`Team: ${input.teamKey}\nProject: ${input.project}\n\nNote:\n${input.note}`];
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
