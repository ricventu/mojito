import { describe, expect, it } from "vitest";
import { buildTicketPrompt } from "../../src/sessions/prompt";

describe("buildTicketPrompt", () => {
  it("is the exact text", () => {
    expect(buildTicketPrompt("RIC-123")).toBe(
      'Read ticket RIC-123 from Linear and carry it out.\nIf the ticket leaves design decisions open, use the superpowers:brainstorming skill before implementing; if it is already clear and specific, skip it.\nWhen the work is ready for review, move the ticket to "In Review" on Linear.');
  });
});
