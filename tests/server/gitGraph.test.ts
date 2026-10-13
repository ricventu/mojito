import { describe, it, expect } from "vitest";
import {
  attachRefs, isValidHash, markWorktrees, parseCounts, parseLog, parseNameStatus, parseRefs,
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
