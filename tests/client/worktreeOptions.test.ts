import { describe, it, expect } from "vitest";
import { REPO_ROOT, worktreeOptions } from "@/lib/worktreeOptions";

describe("worktreeOptions", () => {
  it("leads with the repo root, which is the no-pick value", () => {
    expect(worktreeOptions([])).toEqual([{ value: REPO_ROOT, label: "Repo root" }]);
    expect(REPO_ROOT).toBe("");
  });

  it("labels each worktree by its branch and carries its path as the value", () => {
    expect(worktreeOptions([
      { path: "/repo/.claude/worktrees/RIC-9-x", branch: "RIC-9-x" },
      { path: "/elsewhere/legacy", branch: "ric-46-legacy" },
    ])).toEqual([
      { value: REPO_ROOT, label: "Repo root" },
      { value: "/repo/.claude/worktrees/RIC-9-x", label: "RIC-9-x" },
      { value: "/elsewhere/legacy", label: "ric-46-legacy" },
    ]);
  });

  // A detached worktree has no branch to name it with, and an option needs a label to be
  // findable in the searchable select at all.
  it("falls back to the directory name for a worktree with no branch", () => {
    expect(worktreeOptions([{ path: "/repo/.claude/worktrees/detached-one", branch: "" }])[1])
      .toEqual({ value: "/repo/.claude/worktrees/detached-one", label: "detached-one" });
  });

  it("keeps the order the server listed them in", () => {
    const labels = worktreeOptions([
      { path: "/a", branch: "b-second" },
      { path: "/b", branch: "a-first" },
    ]).map((o) => o.label);
    expect(labels).toEqual(["Repo root", "b-second", "a-first"]);
  });
});
