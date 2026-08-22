import { describe, it, expect } from "vitest";
import {
  worktreeAnswer, launchWorktreeFields, canPickWorktree,
  type WorktreeStatus,
} from "@/lib/worktreeChoice";

const status: WorktreeStatus = {
  exists: false,
  branches: ["main", "dev"],
  defaultBranch: "main",
  worktrees: [
    { path: "/repo/.claude/worktrees/RIC-9-x", branch: "RIC-9-x" },
    { path: "/repo/.claude/worktrees/RIC-8-y", branch: "RIC-8-y" },
  ],
};

describe("canPickWorktree", () => {
  it("is true only when the repo has a worktree to offer", () => {
    expect(canPickWorktree(status)).toBe(true);
    expect(canPickWorktree({ ...status, worktrees: [] })).toBe(false);
  });
});

describe("worktreeAnswer", () => {
  it("'no' launches in the repo root, creating and picking nothing", () => {
    expect(worktreeAnswer("no", status)).toEqual({ kind: "no", baseBranch: "", worktree: "" });
  });

  it("'create' pins the detected default branch as the base", () => {
    expect(worktreeAnswer("create", status)).toEqual({ kind: "create", baseBranch: "main", worktree: "" });
  });

  // Without a detected default the first local branch is still a better offer than an
  // empty select the user cannot launch from.
  it("'create' falls back to the first local branch, then to nothing", () => {
    expect(worktreeAnswer("create", { ...status, defaultBranch: null }).baseBranch).toBe("main");
    expect(worktreeAnswer("create", { ...status, defaultBranch: null, branches: [] }).baseBranch).toBe("");
  });

  it("'pick' pre-selects the first worktree and creates nothing", () => {
    expect(worktreeAnswer("pick", status))
      .toEqual({ kind: "pick", baseBranch: "", worktree: "/repo/.claude/worktrees/RIC-9-x" });
  });

  // The kind is what the sheet renders on, not the picked value: a user who picks and then
  // resets the select to "Repo root" must still be looking at the select, with a way back.
  it("stays a 'pick' answer after the selection is cleared to the repo root", () => {
    const answer = { ...worktreeAnswer("pick", status), worktree: "" };
    expect(answer.kind).toBe("pick");
    expect(launchWorktreeFields(answer)).toEqual({ createWorktree: false, baseBranch: undefined, worktree: undefined });
  });

  // The button that leads here is hidden without worktrees, but an answer with no pick
  // must still mean "repo root" rather than a launch into the empty string.
  it("'pick' with nothing to pick degrades to the repo root", () => {
    expect(worktreeAnswer("pick", { ...status, worktrees: [] }).worktree).toBe("");
  });
});

describe("launchWorktreeFields", () => {
  it("an unanswered question sends the pre-worktree defaults", () => {
    expect(launchWorktreeFields(null)).toEqual({ createWorktree: false, baseBranch: undefined, worktree: undefined });
  });

  it("carries a create answer's base branch", () => {
    expect(launchWorktreeFields(worktreeAnswer("create", status)))
      .toEqual({ createWorktree: true, baseBranch: "main", worktree: undefined });
  });

  it("carries a picked worktree and asks for no creation", () => {
    expect(launchWorktreeFields(worktreeAnswer("pick", status)))
      .toEqual({ createWorktree: false, baseBranch: undefined, worktree: "/repo/.claude/worktrees/RIC-9-x" });
  });

  // An empty string is the field's own "repo root" value, and the server treats it as no
  // pick either way — but sending it would put a meaningless key on every launch body.
  it("omits an empty pick rather than sending it", () => {
    expect(launchWorktreeFields(worktreeAnswer("no", status)).worktree).toBeUndefined();
  });
});
