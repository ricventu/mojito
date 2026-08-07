import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDocsTarget } from "@/server/docTarget";
import type { SessionMeta } from "@/server/types";

// A real repository with a real linked worktree: resolveWorktree shells out to
// `git worktree list --porcelain` and matches on the branch name, so a fake would
// only prove that the fake was called.
function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

let dir: string;
let repo: string;
let projectsPath: string;
let sessions: Record<string, Partial<SessionMeta>>;

// The registry lookup is a plain function here; the project map is a real file,
// so the ticket path exercises resolveTicketCwd for real rather than a mock of it.
const deps = () => ({
  session: (id: string) => sessions[id] as SessionMeta | undefined,
  projectsPath,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mojito-dt-"));
  repo = join(dir, "repo");
  mkdirSync(repo);
  projectsPath = join(dir, "projects.json");
  // Keyed by Linear team key — that is what resolveRepoFromMap indexes on.
  writeFileSync(projectsPath, JSON.stringify({ RIC: repo }));
  sessions = {};
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const url = (qs: string) => new URL(`http://localhost/api/docs?${qs}`);

describe("resolveDocsTarget", () => {
  it("resolves a session to its cwd, labelled by ticket", () => {
    sessions["mojito-RIC-162-backlog"] = { cwd: "/wt/RIC-162", ticket: "RIC-162", title: "Submenus" };
    expect(resolveDocsTarget(url("session=mojito-RIC-162-backlog"), deps()))
      .toEqual({ ok: true, root: "/wt/RIC-162", label: "RIC-162" });
  });

  it("labels a ticketless session by its title", () => {
    sessions["mojito-custom-mojito-abc"] = { cwd: "/repo/mojito", ticket: "", title: "mojito" };
    expect(resolveDocsTarget(url("session=mojito-custom-mojito-abc"), deps()))
      .toEqual({ ok: true, root: "/repo/mojito", label: "mojito" });
  });

  it("prefers the ticket's worktree over a session cwd frozen at the repo root", () => {
    // A Backlog session is launched before its worktree exists — /lime-design creates
    // it mid-session — so meta.cwd stays the repo root while the spec the session
    // writes lands in the worktree. The docs must follow the worktree, not the cwd.
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "root"]);
    const worktree = join(dir, "wt-ric-162");
    git(repo, ["worktree", "add", "-q", "-b", "ricventu/ric-162-submenus", worktree]);
    sessions["mojito-RIC-162-backlog"] = { cwd: repo, ticket: "RIC-162", title: "Submenus" };

    expect(resolveDocsTarget(url("session=mojito-RIC-162-backlog"), deps()))
      .toEqual({ ok: true, root: realpathSync(worktree), label: "RIC-162" });
  });

  it("keeps a session cwd that is already a worktree when no branch matches the ticket", () => {
    // The inverse guard: a To-Code session launched inside its worktree must not be
    // downgraded to the repo root just because the branch was later renamed.
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["commit", "-q", "--allow-empty", "-m", "root"]);
    sessions["mojito-RIC-9-to-code"] = { cwd: "/wt/renamed-branch", ticket: "RIC-9", title: "t" };
    expect(resolveDocsTarget(url("session=mojito-RIC-9-to-code"), deps()))
      .toEqual({ ok: true, root: "/wt/renamed-branch", label: "RIC-9" });
  });

  it("404s an unknown session", () => {
    expect(resolveDocsTarget(url("session=gone"), deps())).toEqual({
      ok: false, error: "unknown session", code: 404,
    });
  });

  it("400s a session with no working directory", () => {
    sessions["no-cwd"] = { cwd: "", ticket: "RIC-1", title: "t" };
    expect(resolveDocsTarget(url("session=no-cwd"), deps())).toEqual({
      ok: false, error: "session has no working directory", code: 400,
    });
  });

  it("resolves a ticket through the project map to its repo root", () => {
    expect(resolveDocsTarget(url("ticket=RIC-162"), deps()))
      .toEqual({ ok: true, root: repo, label: "RIC-162" });
  });

  it("passes the project through, so a nested project map can be honoured", () => {
    const other = join(dir, "other");
    mkdirSync(other);
    writeFileSync(projectsPath, JSON.stringify({ RIC: { path: repo, projects: { Mojito: other } } }));
    expect(resolveDocsTarget(url("ticket=RIC-162&project=Mojito"), deps()))
      .toEqual({ ok: true, root: other, label: "RIC-162" });
  });

  it("409s a ticket whose team key is not mapped", () => {
    expect(resolveDocsTarget(url("ticket=ZZZ-1"), deps())).toEqual({
      ok: false, error: "no worktree for this ticket", code: 409,
    });
  });

  it("prefers the session when both parameters are present", () => {
    sessions["s"] = { cwd: "/wt/from-session", ticket: "RIC-9", title: "t" };
    expect(resolveDocsTarget(url("session=s&ticket=RIC-162"), deps()))
      .toEqual({ ok: true, root: "/wt/from-session", label: "RIC-9" });
  });

  it("400s when neither session nor ticket is given", () => {
    expect(resolveDocsTarget(url(""), deps())).toEqual({
      ok: false, error: "session or ticket required", code: 400,
    });
  });
});
