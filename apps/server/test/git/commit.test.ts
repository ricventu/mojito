import { describe, expect, it, vi } from "vitest";
import { GitError } from "../../src/git/git";
import { parseNameStatus, parsePatch, readCommit, readDiff } from "../../src/git/commit";

describe("parseNameStatus", () => {
  it("reads -z tokens, renames and copies carrying two paths", () => {
    expect(parseNameStatus("M\0a.txt\0R087\0old\0new\0A\0we ird.txt\0")).toEqual([
      { status: "M", path: "a.txt" },
      { status: "R", from: "old", path: "new" },
      { status: "A", path: "we ird.txt" },
    ]);
    expect(parseNameStatus("C100\0src\0dst\0")).toEqual([{ status: "C", from: "src", path: "dst" }]);
  });

  it("answers an empty list for no output", () => {
    expect(parseNameStatus("")).toEqual([]);
  });
});

describe("parsePatch", () => {
  const header = "diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n";

  it("drops everything before the first hunk", () => {
    expect(parsePatch(`${header}@@ -1 +1 @@\n-a\n+b\n`)).toEqual({ patch: "@@ -1 +1 @@\n-a\n+b\n", binary: false, truncated: false });
  });

  it("flags a binary file and sends no patch", () => {
    expect(parsePatch("diff --git a/x b/x\nindex 1..2\nBinary files a/x and b/x differ\n")).toEqual({ patch: "", binary: true, truncated: false });
  });

  it("does not mistake a hunk line that mentions binary files for a binary diff", () => {
    expect(parsePatch(`${header}@@ -1 +1 @@\n+Binary files are fine\n`).binary).toBe(false);
  });

  it("cuts an over-long patch at a line end", () => {
    const line = `+${"x".repeat(98)}\n`;
    const out = parsePatch(`${header}@@ -0,0 +1,3000 @@\n${line.repeat(3000)}`);
    expect(out.truncated).toBe(true);
    expect(out.patch.endsWith("\n")).toBe(true);
    expect(out.patch.length).toBeLessThanOrEqual(262_144);
    expect(out.patch.length).toBeGreaterThan(262_144 - 100);
  });

  it("honours a custom limit and leaves a patch within it alone", () => {
    expect(parsePatch("@@ -1 +1 @@\n-a\n+b\n", 12)).toEqual({ patch: "@@ -1 +1 @@\n", binary: false, truncated: true });
    expect(parsePatch("@@ -1 +1 @@\n", 12).truncated).toBe(false);
  });
});

describe("hash safety", () => {
  it("rejects a bad hash without running git", async () => {
    const run = vi.fn();
    await expect(readCommit("/x", "--all", run)).rejects.toThrow("invalid hash");
    await expect(readDiff("/x", "HEAD", "a.txt", null, run)).rejects.toThrow("invalid hash");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("readCommit", () => {
  it("answers null only when rev-parse exits 1, and rethrows any other git failure", async () => {
    const args = ["rev-parse"];
    const notFound = vi.fn().mockRejectedValue(new GitError(args, "", 1));
    await expect(readCommit("/x", "deadbeef", notFound)).resolves.toBeNull();
    const notARepo = vi.fn().mockRejectedValue(new GitError(args, "fatal: not a git repository", 128));
    await expect(readCommit("/x", "deadbeef", notARepo)).rejects.toBeInstanceOf(GitError);
    const timedOut = vi.fn().mockRejectedValue(new GitError(args, "", null));
    await expect(readCommit("/x", "deadbeef", timedOut)).rejects.toBeInstanceOf(GitError);
    await expect(readDiff("/x", "deadbeef", "a.txt", null, timedOut)).rejects.toBeInstanceOf(GitError);
  });
});
