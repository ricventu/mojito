import { describe, expect, it } from "vitest";
import { CLEAN_PROMPT, WORKTREE_INSTRUCTION, buildGitResolvePrompt, buildTicketPrompt } from "../../src/sessions/prompt";

describe("buildTicketPrompt", () => {
  it("is the exact text", () => {
    expect(buildTicketPrompt("RIC-123")).toBe(
      'Read ticket RIC-123 from Linear. Determine whether to start with brainstorming or a development plan.\nOnce the work is complete, move the ticket to "In Review" in Linear.');
  });

  it("fills every {ticket} of a custom template", () => {
    expect(buildTicketPrompt("RIC-7", "Do {ticket}. Then close {ticket}.")).toBe("Do RIC-7. Then close RIC-7.");
  });

  it("leaves any other brace alone", () => {
    expect(buildTicketPrompt("RIC-7", "{ticket}: {project} $& $1")).toBe("RIC-7: {project} $& $1");
  });

  it("ends with the worktree instruction only when asked", () => {
    expect(buildTicketPrompt("RIC-7", "Do {ticket}.", true)).toBe(`Do RIC-7.\n${WORKTREE_INSTRUCTION}`);
    expect(buildTicketPrompt("RIC-7", "Do {ticket}.", false)).toBe("Do RIC-7.");
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

describe("CLEAN_PROMPT", () => {
  it("asks before deleting and keeps away from other sessions' work", () => {
    expect(CLEAN_PROMPT).toMatch(/fetch --prune/);
    expect(CLEAN_PROMPT).toMatch(/squash/);
    expect(CLEAN_PROMPT).toMatch(/locked/);
    expect(CLEAN_PROMPT).toMatch(/wait for my confirmation/i);
    expect(CLEAN_PROMPT).toMatch(/never --force/);
    expect(CLEAN_PROMPT).toMatch(/never force-push/i);
    expect(CLEAN_PROMPT).toContain("worktree prune");
  });
});
