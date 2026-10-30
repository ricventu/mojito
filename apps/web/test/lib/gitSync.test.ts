import { describe, expect, it } from "vitest";
import type { SessionMeta } from "@mojito/shared";
import { gitSyncAction } from "@/lib/gitSync";

const session = { id: "mj-web-git" } as SessionMeta;

describe("gitSyncAction", () => {
  it("counts what a pull brought in", () => {
    expect(gitSyncAction("pull", { status: "updated", branch: "main", from: "a", to: "b", commits: 3 })).toEqual({
      kind: "toast",
      message: "Pulled 3 commits into main",
    });
    expect(gitSyncAction("pull", { status: "updated", branch: "main", from: "a", to: "b", commits: 1 })).toEqual({
      kind: "toast",
      message: "Pulled 1 commit into main",
    });
  });

  it("says when there was nothing to do, per operation", () => {
    expect(gitSyncAction("pull", { status: "up-to-date", branch: "main" })).toEqual({ kind: "toast", message: "main is already up to date" });
    expect(gitSyncAction("push", { status: "up-to-date", branch: "main" })).toEqual({ kind: "toast", message: "Nothing to push on main" });
  });

  it("mentions the pull a push needed first", () => {
    expect(gitSyncAction("push", { status: "pushed", branch: "main", commits: 2, pulled: 0 })).toEqual({
      kind: "toast",
      message: "Pushed 2 commits to main",
    });
    expect(gitSyncAction("push", { status: "pushed", branch: "main", commits: 1, pulled: 4 })).toEqual({
      kind: "toast",
      message: "Pulled 4 commits, then pushed 1 commit to main",
    });
  });

  it("opens the git session on a conflict", () => {
    expect(gitSyncAction("pull", { status: "conflict", session, alreadyOpen: false })).toEqual({
      kind: "open",
      sessionId: "mj-web-git",
      message: "Pull hit a conflict: Claude is resolving it",
    });
    expect(gitSyncAction("push", { status: "conflict", session, alreadyOpen: true })).toEqual({
      kind: "open",
      sessionId: "mj-web-git",
      message: "Push hit a conflict: the git session is already open",
    });
  });
});
