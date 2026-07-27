import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDocsTarget } from "@/server/docTarget";
import type { SessionMeta } from "@/server/types";

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
  projectsPath = join(dir, "lime-projects.json");
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
