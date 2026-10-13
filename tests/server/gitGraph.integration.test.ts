// Checks the parsers against git's actual output, not against a fake written to the same
// assumptions.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, renameSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCommit, readGitGraph } from "@/server/gitGraph";

const hasGit = (() => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();

let dir: string;
let repo: string;
const git = (args: string[], cwd = repo) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=Tester", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
    { cwd, encoding: "utf8" }).trim();
const commit = (file: string, msg: string) => { writeFileSync(join(repo, file), msg); git(["add", "-A"]); git(["commit", "-m", msg]); return git(["rev-parse", "HEAD"]); };

describe.skipIf(!hasGit)("git graph against real git", () => {
  let root: string, featTip: string, mergeHash: string;

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "mojito-gg-")));
    repo = join(dir, "repo");
    mkdirSync(repo);
    git(["init", "-q", "-b", "main"]);
    root = commit("a.txt", "root");
    git(["tag", "-a", "v0", "-m", "first release"]);
    git(["checkout", "-q", "-b", "feature/a,b->c"]);
    commit("b.txt", "feat one, with | separators");
    renameSync(join(repo, "b.txt"), join(repo, "b renamed.txt"));
    git(["add", "-A"]);
    git(["commit", "-m", "rename"]);
    featTip = git(["rev-parse", "HEAD"]);
    git(["checkout", "-q", "main"]);
    commit("c.txt", "main moves");
    // A remote-tracking ref without a remote: enough for --remotes=origin and for the
    // highlight's base, and no network.
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    git(["worktree", "add", "-q", join(repo, ".claude", "worktrees", "feat"), "feature/a,b->c"]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads commits, refs, peeled tags and worktree badges", async () => {
    const g = await readGitGraph(repo, { skip: 0, highlight: null }, undefined);
    expect(g.commits.map((c) => c.subject).sort()).toEqual(["feat one, with | separators", "main moves", "rename", "root"]);
    const byHash = new Map(g.commits.map((c) => [c.hash, c]));
    expect(byHash.get(root)!.refs).toEqual([{ name: "v0", kind: "tag" }]);
    expect(byHash.get(featTip)!.refs).toEqual([{ name: "feature/a,b->c", kind: "local", worktree: true, mojito: true }]);
    // Looked up by subject, not by position: with two tips, which one topo order puts
    // first is git's call.
    expect(g.commits.find((c) => c.subject === "main moves")!.refs.map((r) => r.name)).toEqual(["main", "origin/main"]);
    expect(g.hasMore).toBe(false);
  });

  it("counts the highlighted branch against origin's default", async () => {
    const g = await readGitGraph(repo, { skip: 0, highlight: "feature/a,b->c" }, undefined);
    expect(g.highlight).toMatchObject({ branch: "feature/a,b->c", tip: featTip, base: "origin/main", ahead: 2, behind: 1, merged: false });
  });

  it("reports a merged branch as merged", async () => {
    git(["merge", "-q", "--no-ff", "-m", "merge feat", "feature/a,b->c"]);
    mergeHash = git(["rev-parse", "HEAD"]);
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    const g = await readGitGraph(repo, { skip: 0, highlight: "feature/a,b->c" }, undefined);
    expect(g.highlight).toMatchObject({ ahead: 0, merged: true });
  });

  it("lists a commit's files, renames included, and a merge's against its first parent", async () => {
    const rename = await readCommit(repo, featTip.slice(0, 10), undefined);
    expect(rename?.files).toEqual([{ status: "R", from: "b.txt", path: "b renamed.txt" }]);
    expect(rename?.author).toBe("Tester");
    const merge = await readCommit(repo, mergeHash, undefined);
    expect(merge?.parents).toHaveLength(2);
    expect(merge?.files.map((f) => f.path)).toEqual(["b renamed.txt"]);
    expect(await readCommit(repo, "0000000", undefined)).toBeNull();
  });

  it("answers an empty graph for a fresh repo", async () => {
    const empty = join(dir, "empty");
    mkdirSync(empty);
    git(["init", "-q", "-b", "main"], empty);
    expect(await readGitGraph(empty, { skip: 0, highlight: null }, undefined))
      .toEqual({ head: null, highlight: null, commits: [], hasMore: false });
  });

  it("fails on a directory that is not a repo", async () => {
    const plain = join(dir, "plain");
    mkdirSync(plain);
    await expect(readGitGraph(plain, { skip: 0, highlight: null }, undefined)).rejects.toThrow();
  });
});
