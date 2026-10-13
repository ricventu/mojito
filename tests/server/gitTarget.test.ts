import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { currentBranch, resolveGitTarget } from "@/server/gitTarget";
import type { SessionMeta } from "@/server/types";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8" }).trim();
}

let dir: string, repo: string, projectsPath: string;
let sessions: Record<string, Partial<SessionMeta>>;
let branches: Record<string, string | null>;
const deps = () => ({
  session: (id: string) => sessions[id] as SessionMeta | undefined,
  projectsPath,
  currentBranch: (cwd: string) => branches[cwd] ?? null,
});
const url = (qs: string) => new URL(`http://localhost/api/git/graph?${qs}`);

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "mojito-gt-")));
  repo = join(dir, "repo");
  mkdirSync(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["commit", "-q", "--allow-empty", "-m", "root"]);
  projectsPath = join(dir, "projects.json");
  writeFileSync(projectsPath, JSON.stringify({ RIC: { path: repo, projects: { Mojito: repo } } }));
  sessions = {};
  branches = {};
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("resolveGitTarget", () => {
  it("resolves a mapped project to its repo, with nothing highlighted", () => {
    expect(resolveGitTarget(url("project=Mojito"), deps()))
      .toEqual({ ok: true, cwd: repo, label: "Mojito", highlight: null });
  });

  it("404s an unmapped project", () => {
    expect(resolveGitTarget(url("project=Nope"), deps())).toMatchObject({ ok: false, code: 404 });
  });

  it("resolves a session to its cwd and highlights the branch checked out there", () => {
    sessions.s1 = { cwd: "/wt/x", ticket: "", title: "mojito" };
    branches["/wt/x"] = "feature/x";
    expect(resolveGitTarget(url("session=s1"), deps()))
      .toEqual({ ok: true, cwd: "/wt/x", label: "mojito", highlight: "feature/x" });
  });

  it("follows a ticket session into its worktree", () => {
    const wt = join(repo, ".claude", "worktrees", "RIC-9-x");
    git(repo, ["worktree", "add", "-q", "-b", "RIC-9-x", wt]);
    sessions.s2 = { cwd: repo, ticket: "RIC-9", title: "t", projectName: "Mojito" };
    branches[wt] = "RIC-9-x";
    expect(resolveGitTarget(url("session=s2"), deps()))
      .toEqual({ ok: true, cwd: wt, label: "RIC-9", highlight: "RIC-9-x" });
  });

  it("404s an unknown session and 400s one with no cwd", () => {
    expect(resolveGitTarget(url("session=gone"), deps())).toMatchObject({ ok: false, code: 404 });
    sessions.s3 = { cwd: "", ticket: "", title: "x" };
    expect(resolveGitTarget(url("session=s3"), deps())).toMatchObject({ ok: false, code: 400 });
  });

  it("resolves a ticket with a worktree to it, highlighted", () => {
    const wt = join(repo, ".claude", "worktrees", "RIC-7-y");
    git(repo, ["worktree", "add", "-q", "-b", "RIC-7-y", wt]);
    branches[wt] = "RIC-7-y";
    expect(resolveGitTarget(url("ticket=RIC-7&project=Mojito"), deps()))
      .toEqual({ ok: true, cwd: wt, label: "RIC-7", highlight: "RIC-7-y" });
  });

  it("falls back to the repo root, unhighlighted, for a ticket with no worktree", () => {
    expect(resolveGitTarget(url("ticket=RIC-8&project=Mojito"), deps()))
      .toEqual({ ok: true, cwd: repo, label: "RIC-8", highlight: null });
  });

  it("404s a ticket whose team maps to no repo", () => {
    expect(resolveGitTarget(url("ticket=ZZZ-1"), deps())).toMatchObject({ ok: false, code: 404 });
  });

  it("400s a query naming no target", () => {
    expect(resolveGitTarget(url(""), deps())).toMatchObject({ ok: false, code: 400 });
  });
});

describe("currentBranch", () => {
  it("names the checked-out branch", () => {
    expect(currentBranch(repo)).toBe("main");
  });

  it("answers null on a detached HEAD", () => {
    git(repo, ["checkout", "-q", "--detach"]);
    expect(currentBranch(repo)).toBeNull();
  });

  it("answers null outside a repo", () => {
    expect(currentBranch(dir)).toBeNull();
  });
});
