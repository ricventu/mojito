import { describe, expect, it } from "vitest";
import { buildGitResolvePrompt, buildTicketPrompt } from "../../src/sessions/prompt";

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

describe("buildGitResolvePrompt", () => {
  const conflict = { status: "conflict" as const, branch: "main", upstream: "origin/main", reason: "rebasing conflicts in:\na.txt" };

  it("names the operation, the branch, the upstream and why Mojito stopped", () => {
    const prompt = buildGitResolvePrompt("pull", conflict);
    expect(prompt).toContain("Pull of branch main");
    expect(prompt).toContain("origin/main");
    expect(prompt).toContain("rebasing conflicts in:\na.txt");
    expect(prompt).toMatch(/never force-push/i);
    expect(prompt).toContain("Do not push.");
  });

  it("asks a push's session to push once it is resolved", () => {
    const prompt = buildGitResolvePrompt("push", conflict);
    expect(prompt).toContain("Push of branch main");
    expect(prompt).not.toContain("Do not push.");
    expect(prompt).toMatch(/then push it/);
  });
});
