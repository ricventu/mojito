import { describe, it, expect, vi } from "vitest";
import { hasNothingToMerge } from "@/server/ticketMergeState";

function deps(over: Partial<Parameters<typeof hasNothingToMerge>[3]> = {}) {
  return {
    resolveTicketDirs: vi.fn(async () => ({ worktree: "/repo/.worktrees/RIC-110", repoRoot: "/repo" })),
    isAlreadyMerged: vi.fn(async () => false),
    ...over,
  };
}

describe("hasNothingToMerge", () => {
  it("defers to the git check when the ticket has a worktree of its own", async () => {
    const d = deps({ isAlreadyMerged: vi.fn(async () => true) });
    expect(await hasNothingToMerge("/cfg.json", "RIC-110", "mojito", d)).toBe(true);
    expect(d.isAlreadyMerged).toHaveBeenCalledWith({ worktree: "/repo/.worktrees/RIC-110", repoRoot: "/repo" });
  });

  it("is false when the branch still has commits to merge", async () => {
    expect(await hasNothingToMerge("/cfg.json", "RIC-110", "mojito", deps())).toBe(false);
  });

  // The prompt no longer tells a session to take a branch, so small work lands straight in the
  // checkout. There is nothing to merge, and no git call worth making.
  it("is true without touching git when the ticket has no worktree", async () => {
    const d = deps({ resolveTicketDirs: vi.fn(async () => ({ worktree: null, repoRoot: "/repo" })) });
    expect(await hasNothingToMerge("/cfg.json", "RIC-110", "mojito", d)).toBe(true);
    expect(d.isAlreadyMerged).not.toHaveBeenCalled();
  });

  it("is true when the worktree IS the main checkout", async () => {
    const d = deps({ resolveTicketDirs: vi.fn(async () => ({ worktree: "/repo", repoRoot: "/repo" })) });
    expect(await hasNothingToMerge("/cfg.json", "RIC-110", "mojito", d)).toBe(true);
    expect(d.isAlreadyMerged).not.toHaveBeenCalled();
  });

  it("is true when the main checkout cannot be resolved", async () => {
    const d = deps({ resolveTicketDirs: vi.fn(async () => ({ worktree: "/repo/.worktrees/RIC-110", repoRoot: null })) });
    expect(await hasNothingToMerge("/cfg.json", "RIC-110", "mojito", d)).toBe(true);
    expect(d.isAlreadyMerged).not.toHaveBeenCalled();
  });
});
