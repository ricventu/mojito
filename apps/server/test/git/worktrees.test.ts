import { describe, expect, it, vi } from "vitest";
import { countWorktrees, parseWorktreeCount } from "../../src/git/worktrees";

const porcelain = [
  "worktree /repo/web",
  "HEAD 1111111111111111111111111111111111111111",
  "branch refs/heads/main",
  "",
  "worktree /repo/web/.claude/worktrees/ric-1",
  "HEAD 2222222222222222222222222222222222222222",
  "branch refs/heads/worktree-ric-1",
  "locked",
  "",
  "worktree /tmp/detached",
  "HEAD 3333333333333333333333333333333333333333",
  "detached",
  "",
  "worktree /tmp/gone",
  "HEAD 4444444444444444444444444444444444444444",
  "branch refs/heads/old",
  "prunable gitdir file points to non-existent location",
  "",
].join("\n");

describe("parseWorktreeCount", () => {
  it("counts the linked worktrees: not the main checkout, not one whose directory is gone", () => {
    expect(parseWorktreeCount(porcelain)).toBe(2);
  });

  it("is 0 for a checkout with no linked worktree", () => {
    expect(parseWorktreeCount("worktree /repo/web\nHEAD 1111\nbranch refs/heads/main\n\n")).toBe(0);
    expect(parseWorktreeCount("")).toBe(0);
  });
});

describe("countWorktrees", () => {
  it("asks git for the porcelain list in the checkout", async () => {
    const run = vi.fn(async () => porcelain);
    expect(await countWorktrees("/repo/web", run)).toBe(2);
    expect(run).toHaveBeenCalledWith(["worktree", "list", "--porcelain"], "/repo/web");
  });
});
