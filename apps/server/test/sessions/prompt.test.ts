import { describe, expect, it } from "vitest";
import { buildTicketPrompt } from "../../src/sessions/prompt";

describe("buildTicketPrompt", () => {
  it("is the exact text", () => {
    expect(buildTicketPrompt("RIC-123")).toBe(
      'Read ticket RIC-123 from Linear and carry it out.\nIf the ticket leaves design decisions open, use the superpowers:brainstorming skill before implementing; if it is already clear and specific, skip it.\nWhen the work is ready for review, move the ticket to "In Review" on Linear.');
  });

  it("fills every {ticket} of a custom template", () => {
    expect(buildTicketPrompt("RIC-7", "Do {ticket}. Then close {ticket}.")).toBe("Do RIC-7. Then close RIC-7.");
  });

  it("leaves any other brace alone", () => {
    expect(buildTicketPrompt("RIC-7", "{ticket}: {project} $& $1")).toBe("RIC-7: {project} $& $1");
  });
});
