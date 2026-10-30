import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GitError, readGit } from "../../src/git/git";
import { readGraph } from "../../src/git/graph";

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

let root: string;
let repo: string;

function configure(dir: string): void {
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
}

function commit(dir: string, file: string, message: string): void {
  writeFileSync(join(dir, file), `${message}\n`);
  git(dir, "add", file);
  git(dir, "commit", "-qm", message);
}

/** `count` empty commits on `main` in one go; a loop of `git commit` would take seconds. */
function manyCommits(dir: string, count: number): void {
  let stream = "";
  for (let i = 0; i < count; i++) {
    const msg = `c${i}`;
    stream += `commit refs/heads/main\ncommitter Test <test@example.com> ${1_700_000_000 + i} +0000\ndata ${msg.length}\n${msg}\n\n`;
  }
  execFileSync("git", ["fast-import", "--quiet"], { cwd: dir, input: stream });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mojito-graph-"));
  git(root, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(root, "clone", "-q", "origin.git", "repo");
  repo = join(root, "repo");
  configure(repo);
  git(repo, "checkout", "-q", "-b", "main");
  for (const n of [1, 2, 3]) commit(repo, `f${n}.txt`, `base ${n}`);
  git(repo, "push", "-q", "origin", "main");
  git(repo, "remote", "set-head", "origin", "-a");

  git(repo, "worktree", "add", "-q", "-b", "ricventu/ric-7-thing", join(root, "wt"));
  for (const n of [1, 2]) commit(join(root, "wt"), `t${n}.txt`, `ticket ${n}`);

  git(repo, "checkout", "-q", "-b", "side");
  commit(repo, "side.txt", "side work");
  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--no-ff", "-m", "merge side", "side");
  git(repo, "tag", "-a", "-m", "release one", "v1");
  commit(repo, "local.txt", "unpushed");
  return () => rmSync(root, { recursive: true, force: true });
});

describe("readGraph", () => {
  it("lists the commits and measures the checked-out branch against origin/main", async () => {
    const page = await readGraph(repo, { skip: 0, ticket: null }, readGit);
    expect(page.head).toBe(git(repo, "rev-parse", "HEAD"));
    expect(page.highlight).toMatchObject({ branch: "main", base: "origin/main", ahead: 3, behind: 0, merged: false });
    expect(page.highlight?.tip).toBe(page.head);
    expect(page.highlight?.baseTip).toBe(git(repo, "rev-parse", "origin/main"));
    expect(page.hasMore).toBe(false);

    const merge = page.commits.find((c) => c.subject === "merge side");
    expect(merge?.parents).toHaveLength(2);
    expect(merge?.refs).toContainEqual({ name: "v1", kind: "tag" });

    const refs = page.commits.flatMap((c) => c.refs);
    expect(refs).toContainEqual({ name: "ricventu/ric-7-thing", kind: "local", worktree: true });
    expect(refs.some((r) => r.name === "origin/HEAD")).toBe(false);
  });

  it("highlights the ticket's branch when a ticket is given", async () => {
    const page = await readGraph(repo, { skip: 0, ticket: "RIC-7" }, readGit);
    expect(page.highlight).toMatchObject({ branch: "ricventu/ric-7-thing", base: "origin/main", ahead: 2, behind: 0, merged: false });
  });

  it("has no highlight for a ticket with no branch, and still lists the commits", async () => {
    const page = await readGraph(repo, { skip: 0, ticket: "RIC-8" }, readGit);
    expect(page.highlight).toBeNull();
    expect(page.commits.length).toBeGreaterThan(0);
  });

  it("skips commits and has no highlight past the first page", async () => {
    const first = await readGraph(repo, { skip: 0, ticket: null }, readGit);
    const next = await readGraph(repo, { skip: 2, ticket: null }, readGit);
    expect(next.highlight).toBeNull();
    expect(next.commits[0]?.hash).toBe(first.commits[2]?.hash);
  });

  it("pages at 200 commits", async () => {
    const big = join(root, "big");
    mkdirSync(big);
    git(big, "init", "-q", "-b", "main");
    manyCommits(big, 205);
    const first = await readGraph(big, { skip: 0, ticket: null }, readGit);
    expect(first.commits).toHaveLength(200);
    expect(first.hasMore).toBe(true);
    const rest = await readGraph(big, { skip: 200, ticket: null }, readGit);
    expect(rest.commits).toHaveLength(5);
    expect(rest.hasMore).toBe(false);
  });

  it("answers an empty page for a repo with no commits", async () => {
    const empty = join(root, "empty");
    mkdirSync(empty);
    git(empty, "init", "-q");
    expect(await readGraph(empty, { skip: 0, ticket: null }, readGit)).toEqual({ head: null, highlight: null, commits: [], hasMore: false });
  });

  it("rejects with a GitError outside a repo", async () => {
    const plain = join(root, "plain");
    mkdirSync(plain);
    await expect(readGraph(plain, { skip: 0, ticket: null }, readGit)).rejects.toBeInstanceOf(GitError);
  });

  it("lists commits with no highlight for a detached head and no remote", async () => {
    const lone = join(root, "lone");
    git(root, "clone", "-q", "origin.git", "lone");
    git(lone, "remote", "remove", "origin");
    git(lone, "checkout", "-q", "--detach");
    const page = await readGraph(lone, { skip: 0, ticket: null }, readGit);
    expect(page.commits.length).toBeGreaterThan(0);
    expect(page.highlight).toBeNull();
    expect(page.head).toBe(git(lone, "rev-parse", "HEAD"));
  });
});
