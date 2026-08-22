import { describe, it, expect, vi } from "vitest";
import { getProjectWorktrees } from "@/server/projectWorktrees";

function deps(over: Partial<Parameters<typeof getProjectWorktrees>[2]> = {}) {
  return {
    loadProjectMap: vi.fn(() => ({ RIC: { path: "/repo", projects: { Mojito: "/repo" } } })),
    resolvePathForProject: vi.fn(() => "/repo" as string | null),
    listPickableWorktrees: vi.fn(() => [{ path: "/repo/.claude/worktrees/RIC-9-x", branch: "RIC-9-x" }]),
    ...over,
  };
}

describe("getProjectWorktrees", () => {
  it("lists the project repo's linked worktrees", () => {
    const res = getProjectWorktrees("/cfg.json", "Mojito", deps());
    expect(res).toEqual({ worktrees: [{ path: "/repo/.claude/worktrees/RIC-9-x", branch: "RIC-9-x" }] });
  });

  // General (no project) is the home directory: not a repo, so there is nothing to list
  // and no git to spend on finding that out.
  it("answers an empty list for no project at all, without touching git", () => {
    const d = deps();
    expect(getProjectWorktrees("/cfg.json", null, d)).toEqual({ worktrees: [] });
    expect(d.listPickableWorktrees).not.toHaveBeenCalled();
  });

  it("answers an empty list for a project the map does not have", () => {
    const d = deps({ resolvePathForProject: vi.fn(() => null) });
    expect(getProjectWorktrees("/cfg.json", "Ghost", d)).toEqual({ worktrees: [] });
    expect(d.listPickableWorktrees).not.toHaveBeenCalled();
  });

  it("carries only path and branch, dropping the parser's flags", () => {
    const d = deps({
      listPickableWorktrees: vi.fn(() => [{ path: "/repo/wt", branch: "", detached: true }]),
    });
    expect(getProjectWorktrees("/cfg.json", "Mojito", d)).toEqual({ worktrees: [{ path: "/repo/wt", branch: "" }] });
  });
});
