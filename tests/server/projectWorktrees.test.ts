import { describe, it, expect, vi } from "vitest";
import { getProjectWorktrees } from "@/server/projectWorktrees";

function deps(over: Partial<Parameters<typeof getProjectWorktrees>[2]> = {}) {
  return {
    loadProjectMap: vi.fn(() => ({ RIC: { path: "/repo", projects: { Mojito: "/repo" } } })),
    resolvePathForProject: vi.fn(() => "/repo" as string | null),
    listPickableWorktrees: vi.fn(() => [{ path: "/repo/.claude/worktrees/RIC-9-x", branch: "RIC-9-x" }]),
    currentBranch: vi.fn(async (_cwd: string) => "main"),
    ...over,
  };
}

describe("getProjectWorktrees", () => {
  it("lists the project repo's linked worktrees and the repo root branch", async () => {
    const res = await getProjectWorktrees("/cfg.json", "Mojito", deps());
    expect(res).toEqual({
      worktrees: [{ path: "/repo/.claude/worktrees/RIC-9-x", branch: "RIC-9-x" }],
      repoRootBranch: "main",
    });
  });

  // General (no project) is the home directory: not a repo, so there is nothing to list
  // and no git to spend on finding that out.
  it("answers an empty list for no project at all, without touching git", async () => {
    const d = deps();
    expect(await getProjectWorktrees("/cfg.json", null, d)).toEqual({ worktrees: [], repoRootBranch: "" });
    expect(d.listPickableWorktrees).not.toHaveBeenCalled();
    expect(d.currentBranch).not.toHaveBeenCalled();
  });

  it("answers an empty list for a project the map does not have", async () => {
    const d = deps({ resolvePathForProject: vi.fn(() => null) });
    expect(await getProjectWorktrees("/cfg.json", "Ghost", d)).toEqual({ worktrees: [], repoRootBranch: "" });
    expect(d.listPickableWorktrees).not.toHaveBeenCalled();
    expect(d.currentBranch).not.toHaveBeenCalled();
  });

  it("carries only path and branch, dropping the parser's flags", async () => {
    const d = deps({
      listPickableWorktrees: vi.fn(() => [{ path: "/repo/wt", branch: "", detached: true }]),
    });
    expect(await getProjectWorktrees("/cfg.json", "Mojito", d)).toEqual({
      worktrees: [{ path: "/repo/wt", branch: "" }],
      repoRootBranch: "main",
    });
  });

  it("returns empty repoRootBranch when currentBranch throws", async () => {
    const d = deps({ currentBranch: vi.fn(async () => { throw new Error("detached HEAD"); }) });
    const res = await getProjectWorktrees("/cfg.json", "Mojito", d);
    expect(res.repoRootBranch).toBe("");
    expect(res.worktrees).toEqual([{ path: "/repo/.claude/worktrees/RIC-9-x", branch: "RIC-9-x" }]);
  });
});
