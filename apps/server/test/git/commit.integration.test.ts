import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GitError, readGit } from "../../src/git/git";
import { readCommit, readDiff } from "../../src/git/commit";

// Real git, in a temp dir, with the user's own git config out of the way.
const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM };
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});
afterAll(() => {
  for (const [key, value] of [["GIT_CONFIG_GLOBAL", saved.global], ["GIT_CONFIG_NOSYSTEM", saved.nosystem]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const WEIRD = "dir/we ird*.txt";
let root: string;
let repo: string;
let renameCommit: string;
let mergeCommit: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mojito-commit-"));
  repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-qm", "first");

  git(repo, "mv", "a.txt", "b.txt");
  writeFileSync(join(repo, "b.txt"), "one\ntwo\nthree\nfour\n");
  writeFileSync(join(repo, "bin.dat"), Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
  mkdirSync(join(repo, "dir"));
  writeFileSync(join(repo, WEIRD), "odd content\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "rename and add", "-m", "Body line one.\nBody line two.");
  renameCommit = git(repo, "rev-parse", "HEAD");

  git(repo, "checkout", "-q", "-b", "side");
  writeFileSync(join(repo, "side.txt"), "side\n");
  git(repo, "add", "side.txt");
  git(repo, "commit", "-qm", "side work");
  git(repo, "checkout", "-q", "main");
  writeFileSync(join(repo, "main.txt"), "main\n");
  git(repo, "add", "main.txt");
  git(repo, "commit", "-qm", "main work");
  git(repo, "merge", "-q", "--no-ff", "-m", "merge side", "side");
  mergeCommit = git(repo, "rev-parse", "HEAD");
  return () => rmSync(root, { recursive: true, force: true });
});

describe("readCommit", () => {
  it("lists a rename with its old path and keeps a multi-line message", async () => {
    const details = await readCommit(repo, renameCommit.slice(0, 10), readGit);
    expect(details?.hash).toBe(renameCommit);
    expect(details?.author).toBe("Test");
    expect(details?.email).toBe("test@example.com");
    expect(details?.moreFiles).toBe(0);
    expect(details?.message).toBe("rename and add\n\nBody line one.\nBody line two.");
    expect(details?.files).toContainEqual({ status: "R", from: "a.txt", path: "b.txt" });
    expect(details?.files.map((f) => f.path)).toContain(WEIRD);
  });

  it("lists what a merge brought in against its first parent", async () => {
    const details = await readCommit(repo, mergeCommit, readGit);
    expect(details?.parents).toHaveLength(2);
    expect(details?.files).toEqual([{ status: "A", path: "side.txt" }]);
  });

  it("answers null for a hash that is not in the repo", async () => {
    expect(await readCommit(repo, "deadbeef", readGit)).toBeNull();
  });

  it("rejects with a GitError outside a repo, and a real failure carries a numeric exit code", async () => {
    const elsewhere = join(root, "not-a-repo");
    mkdirSync(elsewhere);
    const err = await readCommit(elsewhere, "deadbeef", readGit).catch((e) => e);
    expect(err).toBeInstanceOf(GitError);
    expect(err.exitCode).toBe(128);
    const missing = await readGit(["rev-parse", "--verify", "-q", "deadbeef^{commit}"], repo).catch((e) => e);
    expect(missing.exitCode).toBe(1);
  });
});

describe("a project on a subdirectory of its repo", () => {
  it("lists repo-root paths and diffs them", async () => {
    const sub = join(repo, "dir");
    const details = await readCommit(sub, renameCommit, readGit);
    expect(details?.files.map((f) => f.path)).toContain(WEIRD);
    const diff = await readDiff(sub, renameCommit, WEIRD, null, readGit);
    expect(diff?.patch).toContain("+odd content");
    const renamed = await readDiff(sub, renameCommit, "b.txt", "a.txt", readGit);
    expect(renamed?.patch).toContain("+four");
  });
});

describe("readDiff", () => {
  it("diffs a renamed file as a rename when given its old path", async () => {
    const diff = await readDiff(repo, renameCommit, "b.txt", "a.txt", readGit);
    expect(diff?.binary).toBe(false);
    expect(diff?.patch.startsWith("@@")).toBe(true);
    expect(diff?.patch).toContain("+four");
    expect(diff?.patch).not.toContain("+one");
  });

  it("flags a binary file", async () => {
    expect(await readDiff(repo, renameCommit, "bin.dat", null, readGit)).toEqual({ patch: "", binary: true, truncated: false });
  });

  it("treats a path as literal, glob characters and spaces included", async () => {
    const diff = await readDiff(repo, renameCommit, WEIRD, null, readGit);
    expect(diff?.patch).toContain("+odd content");
  });

  it("does not expand a glob in the path", async () => {
    const diff = await readDiff(repo, renameCommit, "dir/*.txt", null, readGit);
    expect(diff?.patch).toBe("");
  });

  it("answers null for an unknown hash", async () => {
    expect(await readDiff(repo, "deadbeef", "b.txt", null, readGit)).toBeNull();
  });
});
