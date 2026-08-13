import { describe, it, expect, vi } from "vitest";
import { hasNothingToMerge } from "@/server/ticketMergeState";

function deps(over: Partial<Parameters<typeof hasNothingToMerge>[3]> = {}) {
  return {
    resolveTicketDirs: vi.fn(async () => ({ worktree: "/repo/.worktrees/RIC-110", repoRoot: "/repo" })),
    isOnDefaultBranch: vi.fn(async () => false),
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
  // checkout. Nothing to merge — but only because that checkout is ON the default branch, which
  // is a question for git, not an assumption.
  it("is true when the ticket has no worktree and the repo root is on the default branch", async () => {
    const d = deps({
      resolveTicketDirs: vi.fn(async () => ({ worktree: null, repoRoot: "/repo" })),
      isOnDefaultBranch: vi.fn(async () => true),
    });
    expect(await hasNothingToMerge("/cfg.json", "RIC-110", "mojito", d)).toBe(true);
    expect(d.isOnDefaultBranch).toHaveBeenCalledWith({ checkout: "/repo", repoRoot: "/repo" });
    expect(d.isAlreadyMerged).not.toHaveBeenCalled();
  });

  // No worktree, but the session ran `git checkout -b ric-110-fix` in the repo root and
  // committed there. Those commits are unmerged, so the gate must offer the approves.
  it("is false when the ticket has no worktree and the repo root is on a ticket branch", async () => {
    const d = deps({ resolveTicketDirs: vi.fn(async () => ({ worktree: null, repoRoot: "/repo" })) });
    expect(await hasNothingToMerge("/cfg.json", "RIC-110", "mojito", d)).toBe(false);
    expect(d.isAlreadyMerged).toHaveBeenCalledWith({ worktree: "/repo", repoRoot: "/repo" });
  });

  it("is true when the worktree IS the main checkout and it sits on the default branch", async () => {
    const d = deps({
      resolveTicketDirs: vi.fn(async () => ({ worktree: "/repo", repoRoot: "/repo" })),
      isOnDefaultBranch: vi.fn(async () => true),
    });
    expect(await hasNothingToMerge("/cfg.json", "RIC-110", "mojito", d)).toBe(true);
    expect(d.isAlreadyMerged).not.toHaveBeenCalled();
  });

  // The Critical: matchWorktree matches the MAIN worktree too when its branch carries the
  // ticket id, so `worktree === repoRoot` used to short-circuit to true. With commits on
  // `ric-110-fix` in that very checkout, the gate would have offered only Mark Done and
  // written Done over unmerged work.
  it("is false when the worktree IS the main checkout but it sits on a ticket branch", async () => {
    const d = deps({ resolveTicketDirs: vi.fn(async () => ({ worktree: "/repo", repoRoot: "/repo" })) });
    expect(await hasNothingToMerge("/cfg.json", "RIC-110", "mojito", d)).toBe(false);
    expect(d.isAlreadyMerged).toHaveBeenCalledWith({ worktree: "/repo", repoRoot: "/repo" });
  });

  // "I could not tell" is not "there is nothing to merge": answering true here would hand a
  // worktree full of unmerged commits a Mark Done button.
  it("is false when the main checkout cannot be resolved", async () => {
    const d = deps({ resolveTicketDirs: vi.fn(async () => ({ worktree: "/repo/.worktrees/RIC-110", repoRoot: null })) });
    expect(await hasNothingToMerge("/cfg.json", "RIC-110", "mojito", d)).toBe(false);
    expect(d.isOnDefaultBranch).not.toHaveBeenCalled();
    expect(d.isAlreadyMerged).not.toHaveBeenCalled();
  });
});
