import { describe, expect, it } from "vitest";
import { attachRefs, markWorktrees, parseCounts, parseLog, parseRefs, parseWorktrees, type RefEntry } from "../../src/git/graph";

const RS = "\x1e";
const NUL = "\x00";

describe("parseLog", () => {
  it("splits records on RS and fields on NUL, so a subject cannot break the parse", () => {
    const out = [
      ["aaa", "p1 p2", "Ann", "2026-10-30T10:00:00+01:00", "a | b, c -> d"].join(NUL) + RS + "\n",
      ["bbb", "", "Bob", "2026-10-29T09:00:00+00:00", "root"].join(NUL) + RS + "\n",
    ].join("");
    expect(parseLog(out)).toEqual([
      { hash: "aaa", parents: ["p1", "p2"], author: "Ann", date: "2026-10-30T10:00:00+01:00", subject: "a | b, c -> d" },
      { hash: "bbb", parents: [], author: "Bob", date: "2026-10-29T09:00:00+00:00", subject: "root" },
    ]);
  });

  it("answers nothing for an empty output", () => {
    expect(parseLog("")).toEqual([]);
  });
});

describe("parseRefs", () => {
  it("keys an annotated tag on its peeled commit and drops origin/HEAD", () => {
    const out = [
      ["aaa", "", "refs/heads/main", "1700000300"],
      ["bbb", "", "refs/remotes/origin/main", "1700000200"],
      ["bbb", "", "refs/remotes/origin/HEAD", "1700000200"],
      ["ttt", "ccc", "refs/tags/v1", "1700000100"],
    ]
      .map((f) => f.join(NUL))
      .join("\n");
    expect(parseRefs(out + "\n")).toEqual([
      { hash: "aaa", ref: { name: "main", kind: "local" }, date: 1700000300 },
      { hash: "bbb", ref: { name: "origin/main", kind: "remote" }, date: 1700000200 },
      { hash: "ccc", ref: { name: "v1", kind: "tag" }, date: 1700000100 },
    ]);
  });

  it("reads an empty date as 0", () => {
    expect(parseRefs(["aaa", "", "refs/heads/x", ""].join(NUL) + "\n")).toEqual([
      { hash: "aaa", ref: { name: "x", kind: "local" }, date: 0 },
    ]);
  });
});

const entry = (name: string, kind: "local" | "remote" | "tag", hash = "aaa", date = 0): RefEntry => ({ hash, ref: { name, kind }, date });

describe("markWorktrees", () => {
  it("marks local branches checked out in a live worktree, never a remote or a prunable one", () => {
    const entries = [entry("main", "local"), entry("feat", "local"), entry("gone", "local"), entry("main", "remote")];
    const worktrees = [
      { branch: "main", prunable: false },
      { branch: "feat", prunable: false },
      { branch: "gone", prunable: true },
      { branch: "", prunable: false },
    ];
    const marked = markWorktrees(entries, worktrees);
    expect(marked.map((e) => e.ref)).toEqual([
      { name: "main", kind: "local", worktree: true },
      { name: "feat", kind: "local", worktree: true },
      { name: "gone", kind: "local" },
      { name: "main", kind: "remote" },
    ]);
  });
});

describe("parseWorktrees", () => {
  it("reads a branch, a detached head and a prunable entry", () => {
    const out = [
      "worktree /repo\nHEAD aaa\nbranch refs/heads/main\n",
      "worktree /repo-detached\nHEAD bbb\ndetached\n",
      "worktree /repo-gone\nHEAD ccc\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n",
    ].join("\n");
    expect(parseWorktrees(out)).toEqual([
      { path: "/repo", branch: "main", prunable: false },
      { path: "/repo-detached", branch: "", prunable: false },
      { path: "/repo-gone", branch: "old", prunable: true },
    ]);
  });

  it("answers nothing for an empty output", () => {
    expect(parseWorktrees("")).toEqual([]);
  });
});

describe("attachRefs", () => {
  it("orders each commit's refs local, remote, tag and leaves the others empty", () => {
    const commits = [
      { hash: "aaa", parents: ["bbb"], author: "Ann", date: "d1", subject: "s1" },
      { hash: "bbb", parents: [], author: "Ann", date: "d2", subject: "s2" },
    ];
    const entries = [entry("v1", "tag"), entry("origin/main", "remote"), entry("main", "local")];
    const out = attachRefs(commits, entries);
    expect(out[0]!.refs.map((r) => r.name)).toEqual(["main", "origin/main", "v1"]);
    expect(out[1]!.refs).toEqual([]);
    expect(out[0]).toMatchObject({ hash: "aaa", subject: "s1" });
  });
});

describe("parseCounts", () => {
  it("reads left as behind and right as ahead", () => {
    expect(parseCounts("3\t5\n")).toEqual({ behind: 3, ahead: 5 });
  });
});
