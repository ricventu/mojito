import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "../../src/git/git";
import { SyncError, pull, push } from "../../src/git/sync";

// Real git, in a temp dir: a bare origin and two clones of it, "local" (the project's checkout)
// and "other" (someone else pushing). The user's own git config must not leak in: a global
// `rebase.autoStash` or `pull.rebase` would change what these assert.
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

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let root: string;
let local: string;
let other: string;

function clone(name: string): string {
  const dir = join(root, name);
  git(root, "clone", "-q", join(root, "origin.git"), name);
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  return dir;
}

function commit(dir: string, file: string, content: string, message = `edit ${file}`): void {
  writeFileSync(join(dir, file), content);
  git(dir, "add", file);
  git(dir, "commit", "-qm", message);
}

const head = (dir: string) => git(dir, "rev-parse", "--short", "HEAD");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mojito-git-"));
  git(root, "init", "-q", "--bare", "-b", "main", "origin.git");
  const seed = clone("seed");
  commit(seed, "a.txt", "one\n", "seed");
  git(seed, "push", "-q", "origin", "main");
  local = clone("local");
  other = clone("other");
  return () => rmSync(root, { recursive: true, force: true });
});

describe("pull", () => {
  it("answers up-to-date when the remote has nothing new", async () => {
    expect(await pull(local, runGit)).toEqual({ status: "up-to-date", branch: "main" });
  });

  it("fast-forwards when only the remote moved, even with unrelated uncommitted changes", async () => {
    commit(other, "b.txt", "b\n");
    commit(other, "c.txt", "c\n");
    git(other, "push", "-q");
    writeFileSync(join(local, "a.txt"), "dirty\n");
    const from = head(local);
    const r = await pull(local, runGit);
    expect(r).toEqual({ status: "updated", branch: "main", from, to: head(other), commits: 2 });
    expect(readFileSync(join(local, "a.txt"), "utf8")).toBe("dirty\n");
  });

  it("hands a fast-forward that would overwrite uncommitted changes to Claude", async () => {
    commit(other, "a.txt", "theirs\n");
    git(other, "push", "-q");
    writeFileSync(join(local, "a.txt"), "mine\n");
    const from = head(local);
    const r = await pull(local, runGit);
    expect(r).toMatchObject({ status: "conflict", branch: "main", upstream: "origin/main" });
    if (r.status === "conflict") expect(r.reason).toContain("a.txt");
    expect(head(local)).toBe(from);
    expect(readFileSync(join(local, "a.txt"), "utf8")).toBe("mine\n");
  });

  it("rebases local commits onto the remote when they do not conflict", async () => {
    commit(other, "b.txt", "b\n");
    git(other, "push", "-q");
    commit(local, "c.txt", "c\n");
    const from = head(local);
    const r = await pull(local, runGit);
    expect(r).toMatchObject({ status: "updated", branch: "main", from, commits: 1 });
    expect(git(local, "log", "--format=%s", "-3").split("\n")).toEqual(["edit c.txt", "edit b.txt", "seed"]);
  });

  it("aborts a conflicting rebase, leaving the repo as it was, and reports the files", async () => {
    commit(other, "a.txt", "theirs\n");
    git(other, "push", "-q");
    commit(local, "a.txt", "mine\n");
    const from = head(local);
    const r = await pull(local, runGit);
    expect(r).toMatchObject({ status: "conflict", branch: "main", upstream: "origin/main" });
    if (r.status === "conflict") expect(r.reason).toContain("a.txt");
    expect(head(local)).toBe(from);
    expect(git(local, "status", "--porcelain")).toBe("");
    expect(() => git(local, "rev-parse", "-q", "--verify", "REBASE_HEAD")).toThrow();
  });

  it("does not rebase over uncommitted changes: diverged and dirty is Claude's", async () => {
    commit(other, "b.txt", "b\n");
    git(other, "push", "-q");
    commit(local, "c.txt", "c\n");
    writeFileSync(join(local, "a.txt"), "dirty\n");
    const from = head(local);
    const r = await pull(local, runGit);
    expect(r).toMatchObject({ status: "conflict", branch: "main" });
    if (r.status === "conflict") expect(r.reason).toMatch(/uncommitted/);
    expect(head(local)).toBe(from);
    expect(readFileSync(join(local, "a.txt"), "utf8")).toBe("dirty\n");
  });

  it("fails on a detached HEAD", async () => {
    git(local, "checkout", "-q", "--detach");
    await expect(pull(local, runGit)).rejects.toThrow(SyncError);
    await expect(pull(local, runGit)).rejects.toThrow(/detached/);
  });

  it("fails on a branch with no upstream", async () => {
    git(local, "checkout", "-qb", "feature");
    await expect(pull(local, runGit)).rejects.toThrow(/feature has no upstream/);
  });
});

describe("push", () => {
  it("pushes the local commits", async () => {
    commit(local, "b.txt", "b\n");
    commit(local, "c.txt", "c\n");
    expect(await push(local, runGit)).toEqual({ status: "pushed", branch: "main", commits: 2, pulled: 0 });
    expect(git(join(root, "origin.git"), "rev-parse", "--short", "main")).toBe(head(local));
  });

  it("answers up-to-date when there is nothing to push", async () => {
    expect(await push(local, runGit)).toEqual({ status: "up-to-date", branch: "main" });
  });

  it("publishes a branch with no upstream to origin and tracks it", async () => {
    git(local, "checkout", "-qb", "feature");
    commit(local, "b.txt", "b\n");
    expect(await push(local, runGit)).toEqual({ status: "pushed", branch: "feature", commits: 1, pulled: 0 });
    expect(git(local, "rev-parse", "--abbrev-ref", "@{u}")).toBe("origin/feature");
  });

  it("pulls first when the remote is ahead, then pushes", async () => {
    commit(other, "b.txt", "b\n");
    git(other, "push", "-q");
    commit(local, "c.txt", "c\n");
    expect(await push(local, runGit)).toEqual({ status: "pushed", branch: "main", commits: 1, pulled: 1 });
    expect(git(join(root, "origin.git"), "log", "--format=%s", "-3", "main").split("\n")).toEqual([
      "edit c.txt",
      "edit b.txt",
      "seed",
    ]);
  });

  it("hands a push whose pull conflicts to Claude, pushing nothing", async () => {
    commit(other, "a.txt", "theirs\n");
    git(other, "push", "-q");
    const remote = git(join(root, "origin.git"), "rev-parse", "--short", "main");
    commit(local, "a.txt", "mine\n");
    const r = await push(local, runGit);
    expect(r).toMatchObject({ status: "conflict", branch: "main", upstream: "origin/main" });
    expect(git(join(root, "origin.git"), "rev-parse", "--short", "main")).toBe(remote);
  });

  it("fails on a detached HEAD", async () => {
    git(local, "checkout", "-q", "--detach");
    await expect(push(local, runGit)).rejects.toThrow(/detached/);
  });
});
