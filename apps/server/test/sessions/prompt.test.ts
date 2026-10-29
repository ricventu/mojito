import { describe, expect, it } from "vitest";
import { buildTicketPrompt } from "../../src/sessions/prompt";

describe("buildTicketPrompt", () => {
  it("is the exact text without brainstorming", () => {
    expect(buildTicketPrompt("RIC-123", false)).toBe(
      'Read ticket RIC-123 from Linear and carry it out.\nWhen the work is ready for review, move the ticket to "In Review" on Linear.');
  });

  it("is the exact text with brainstorming", () => {
    expect(buildTicketPrompt("RIC-123", true)).toBe(
      'Read ticket RIC-123 from Linear and carry it out.\nBefore implementing, use the superpowers:brainstorming skill.\nWhen the work is ready for review, move the ticket to "In Review" on Linear.');
  });
});
