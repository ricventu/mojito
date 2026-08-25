import { describe, it, expect } from "vitest";
import {
  worktreeAnswer, launchWorktreeFields, canPickWorktree, baseBranchOptions, defaultBaseBranch,
  reconcileBaseBranch,
  type WorktreeStatus,
} from "@/lib/worktreeChoice";

const status: WorktreeStatus = {
  exists: false,
  branches: ["main", "dev"],
  remoteBranches: ["origin/main", "origin/dev"],
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

  // The remote default, not the local one: the local main of a checkout Mojito's sessions
  // work in is routinely behind the server.
  it("'create' pins the remote default branch as the base", () => {
    expect(worktreeAnswer("create", status)).toEqual({ kind: "create", baseBranch: "origin/main", worktree: "" });
  });

  it("'create' falls back to the local default when the repo has no remote", () => {
    expect(worktreeAnswer("create", { ...status, remoteBranches: [] }).baseBranch).toBe("main");
  });

  // Without a detected default the first offered branch is still a better offer than an
  // empty select the user cannot launch from.
  it("'create' falls back to the first branch on offer, then to nothing", () => {
    expect(worktreeAnswer("create", { ...status, defaultBranch: null }).baseBranch).toBe("origin/main");
    expect(worktreeAnswer("create", { ...status, defaultBranch: null, remoteBranches: [] }).baseBranch).toBe("main");
    expect(worktreeAnswer("create", { ...status, defaultBranch: null, remoteBranches: [], branches: [] }).baseBranch)
      .toBe("");
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
      .toEqual({ createWorktree: true, baseBranch: "origin/main", worktree: undefined });
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

describe("baseBranchOptions", () => {
  it("lists the remote-tracking branches first, then the local ones", () => {
    expect(baseBranchOptions(status)).toEqual(["origin/main", "origin/dev", "main", "dev"]);
  });

  // `main` and `origin/main` are different commits whenever the checkout is behind, which is
  // the whole reason both are offered — collapsing them would hide the choice.
  it("keeps a local branch and its remote counterpart apart", () => {
    expect(baseBranchOptions({ ...status, branches: ["main"], remoteBranches: ["origin/main"] }))
      .toEqual(["origin/main", "main"]);
  });
});

describe("defaultBaseBranch", () => {
  it("prefers origin's copy of the detected default", () => {
    expect(defaultBaseBranch(status)).toBe("origin/main");
  });

  // Matched by tail rather than by assuming a remote called origin.
  it("finds the default on whatever remote the repo has", () => {
    expect(defaultBaseBranch({ ...status, remoteBranches: ["upstream/main", "upstream/dev"] }))
      .toBe("upstream/main");
  });

  it("takes the local default when no remote carries it", () => {
    expect(defaultBaseBranch({ ...status, remoteBranches: ["origin/other"] })).toBe("main");
  });

  it("answers nothing when there is nothing to offer", () => {
    expect(defaultBaseBranch({ ...status, branches: [], remoteBranches: [], defaultBranch: null })).toBe("");
  });
});

describe("reconcileBaseBranch", () => {
  const answer = { kind: "create" as const, baseBranch: "origin/gone", worktree: "" };

  it("keeps a base that is still on offer after a fetch", () => {
    const kept = { ...answer, baseBranch: "origin/dev" };
    expect(reconcileBaseBranch(kept, status)).toEqual(kept);
  });

  // A fetch --prune drops the tracking ref of a branch deleted on the server: left selected,
  // it renders as a blank select that launches off a branch nobody chose.
  it("falls back to the default when the picked base was pruned away", () => {
    expect(reconcileBaseBranch(answer, status)).toEqual({ ...answer, baseBranch: "origin/main" });
  });

  it("leaves the other two answers (and no answer) alone", () => {
    const pick = { kind: "pick" as const, baseBranch: "", worktree: "/repo/.claude/worktrees/RIC-9-x" };
    expect(reconcileBaseBranch(pick, status)).toEqual(pick);
    expect(reconcileBaseBranch(null, status)).toBeNull();
  });
});
