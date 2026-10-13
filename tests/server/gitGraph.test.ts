import { describe, it, expect } from "vitest";
import {
  attachRefs, isValidHash, markWorktrees, MAX_FILES, parseCounts, parseLog, parseNameStatus, parseRefs,
  readCommit, readGitGraph,
} from "@/server/gitGraph";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40), T = "d".repeat(40);

// git appends a newline after each `%x1e` terminator (tformat), which is why records
// after the first start with "\n".
const rec = (h: string, p: string, s: string) => `${h}\x00${p}\x00Ann\x002026-10-01T10:00:00+02:00\x00${s}\x1e\n`;

describe("parseLog", () => {
  it("splits records and fields, keeping subjects with separators git itself prints", () => {
    const out = rec(A, `${B} ${C}`, "Merge branch 'x' -> main, | done") + rec(B, C, "feat") + rec(C, "", "root");
    expect(parseLog(out)).toEqual([
      { hash: A, parents: [B, C], author: "Ann", date: "2026-10-01T10:00:00+02:00", subject: "Merge branch 'x' -> main, | done" },
      { hash: B, parents: [C], author: "Ann", date: "2026-10-01T10:00:00+02:00", subject: "feat" },
      { hash: C, parents: [], author: "Ann", date: "2026-10-01T10:00:00+02:00", subject: "root" },
    ]);
  });

  it("answers no commits for empty output", () => {
    expect(parseLog("")).toEqual([]);
  });
});

describe("parseRefs", () => {
  it("classifies refs, peels annotated tags and drops origin/HEAD", () => {
    const out = [
      `${A}\x00\x00refs/heads/main`,
      `${B}\x00\x00refs/heads/feature/a,b->c`,
      `${A}\x00\x00refs/remotes/origin/main`,
      `${A}\x00\x00refs/remotes/origin/HEAD`,
      `${T}\x00${C}\x00refs/tags/v1.0`,
      `${B}\x00\x00refs/tags/light`,
      "",
    ].join("\n");
    expect(parseRefs(out)).toEqual([
      { hash: A, ref: { name: "main", kind: "local" } },
      { hash: B, ref: { name: "feature/a,b->c", kind: "local" } },
      { hash: A, ref: { name: "origin/main", kind: "remote" } },
      { hash: C, ref: { name: "v1.0", kind: "tag" } },
      { hash: B, ref: { name: "light", kind: "tag" } },
    ]);
  });
});

describe("markWorktrees", () => {
  const entries = () => [
    { hash: A, ref: { name: "main", kind: "local" as const } },
    { hash: B, ref: { name: "RIC-1-x", kind: "local" as const } },
    { hash: C, ref: { name: "other", kind: "local" as const } },
    { hash: A, ref: { name: "origin/RIC-1-x", kind: "remote" as const } },
  ];

  it("marks branches checked out in a worktree, and Mojito's own separately", () => {
    const marked = markWorktrees(entries(), [
      { path: "/repo", branch: "main" },
      { path: "/repo/.claude/worktrees/RIC-1-x", branch: "RIC-1-x" },
      { path: "/elsewhere/other", branch: "other", prunable: true },
      { path: "/elsewhere/remote", branch: "origin/RIC-1-x" },
    ]);
    expect(marked.map((e) => e.ref)).toEqual([
      { name: "main", kind: "local", worktree: true },
      { name: "RIC-1-x", kind: "local", worktree: true, mojito: true },
      // A prunable worktree's directory is gone: nothing is checked out there.
      { name: "other", kind: "local" },
      // Only local branches can be checked out.
      { name: "origin/RIC-1-x", kind: "remote" },
    ]);
  });
});

describe("attachRefs", () => {
  it("hangs refs on their commit, locals first, then remotes, then tags", () => {
    const commits = [{ hash: A, parents: [], author: "", date: "", subject: "" }];
    const out = attachRefs(commits, [
      { hash: A, ref: { name: "v1", kind: "tag" } },
      { hash: A, ref: { name: "origin/main", kind: "remote" } },
      { hash: A, ref: { name: "main", kind: "local" } },
      { hash: B, ref: { name: "elsewhere", kind: "local" } },
    ]);
    expect(out[0].refs.map((r) => r.name)).toEqual(["main", "origin/main", "v1"]);
  });
});

describe("parseCounts", () => {
  // `rev-list --left-right --count base...branch`: left is base-only (behind), right is
  // branch-only (ahead).
  it("reads left as behind and right as ahead", () => {
    expect(parseCounts("12\t3\n")).toEqual({ behind: 12, ahead: 3 });
  });
});

describe("parseNameStatus", () => {
  it("reads -z output, including renames and paths with spaces and tabs", () => {
    const out = "\nM\0src/a b.ts\0R087\0old\tname.ts\0new.ts\0A\0x.ts\0D\0gone.ts\0";
    expect(parseNameStatus(out)).toEqual([
      { status: "M", path: "src/a b.ts" },
      { status: "R", from: "old\tname.ts", path: "new.ts" },
      { status: "A", path: "x.ts" },
      { status: "D", path: "gone.ts" },
    ]);
  });

  it("answers no files for an empty commit", () => {
    expect(parseNameStatus("\n")).toEqual([]);
  });
});

describe("isValidHash", () => {
  it.each(["abc1234", "a".repeat(40)])("accepts %s", (h) => expect(isValidHash(h)).toBe(true));
  it.each(["abc123", "A".repeat(40), "a".repeat(41), "--output=x", "HEAD", ""])(
    "rejects %s",
    (h) => expect(isValidHash(h)).toBe(false),
  );
});

// A scripted runner: the first matching prefix answers; an Error value throws.
function fakeRun(script: [string[], string | Error][]) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    const hit = script.find(([prefix]) => prefix.every((p, i) => args[i] === p));
    if (!hit) throw new Error(`unscripted: git ${args.join(" ")}`);
    if (hit[1] instanceof Error) throw hit[1];
    return hit[1];
  };
  return { run, calls };
}

describe("readCommit", () => {
  it("never calls git for an invalid hash", async () => {
    const { run, calls } = fakeRun([]);
    await expect(readCommit("/r", "--output=/tmp/x", run)).rejects.toThrow("invalid hash");
    expect(calls).toEqual([]);
  });

  it("answers null for a commit the repo does not have", async () => {
    const { run } = fakeRun([[["rev-parse"], new Error("exit 1")]]);
    expect(await readCommit("/r", "abc1234", run)).toBeNull();
  });

  it(`truncates a file list beyond ${MAX_FILES} entries and reports how many it dropped`, async () => {
    const many = Array.from({ length: MAX_FILES + 5 }, (_, i) => `M\0f${i}.ts\0`).join("");
    const { run } = fakeRun([
      [["rev-parse"], `${A}\n`],
      [["show", "-s"], `${A}\x00${B}\x00Ann\x00ann@x\x002026-10-01T10:00:00+02:00\x00Subject\n\nBody\n`],
      [["show", "--format="], `\n${many}`],
    ]);
    const d = await readCommit("/r", "aaaaaaa", run);
    expect(d?.files).toHaveLength(MAX_FILES);
    expect(d?.moreFiles).toBe(5);
    expect(d?.message).toBe("Subject\n\nBody");
    expect(d?.parents).toEqual([B]);
  });
});

describe("readGitGraph", () => {
  it("propagates a failure to read refs, which is what a non-repo looks like", async () => {
    const { run } = fakeRun([[["for-each-ref"], new Error("not a git repository")]]);
    await expect(readGitGraph("/r", { skip: 0, highlight: null }, run)).rejects.toThrow("not a git repository");
  });

  it("answers an empty graph for a repo with no commits, without running log", async () => {
    const { run, calls } = fakeRun([
      [["for-each-ref"], ""],
      [["rev-parse"], new Error("exit 1")],
      [["worktree"], ""],
    ]);
    expect(await readGitGraph("/r", { skip: 0, highlight: null }, run))
      .toEqual({ head: null, highlight: null, commits: [], hasMore: false });
    expect(calls.some((c) => c[0] === "log")).toBe(false);
  });

  it("sets hasMore from a 201st record and drops it", async () => {
    const log = Array.from({ length: 201 }, (_, i) => rec(i.toString(16).padStart(40, "0"), "", `c${i}`)).join("");
    const { run, calls } = fakeRun([
      [["for-each-ref"], ""],
      [["rev-parse"], `${A}\n`],
      [["worktree"], ""],
      [["log"], log],
    ]);
    const g = await readGitGraph("/r", { skip: 400, highlight: null }, run);
    expect(g.commits).toHaveLength(200);
    expect(g.hasMore).toBe(true);
    const logCall = calls.find((c) => c[0] === "log")!;
    expect(logCall).toContain("--skip=400");
    expect(logCall).toContain("201");
  });
});
